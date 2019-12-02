import * as bitcoin from "bitgo-utxo-lib";

import { toCashAddress, toLegacyAddress } from "bchaddrjs";
import BigNumber from "bignumber.js";
import { List } from "immutable";

import { BitcoinDotCom } from "../common/apis/bitcoinDotCom";
import { Sochain } from "../common/apis/sochain";
import { BitgoUTXOLib } from "../common/libraries/bitgoUtxoLib";
import { subscribeToConfirmations } from "../lib/confirmations";
import { UTXO } from "../lib/mercury";
import { newPromiEvent, PromiEvent } from "../lib/promiEvent";
import { fallback } from "../lib/retry";
import { Asset, Handler } from "../types/types";

interface AddressOptions { }
interface BalanceOptions extends AddressOptions {
    address?: string;
    confirmations?: number; // defaults to 0
}
interface TxOptions extends BalanceOptions {
    fee?: number;           // defaults to 10000
    subtractFee?: boolean;  // defaults to false
}

export class BCHHandler implements Handler {
    private readonly privateKey: { getAddress: () => string; };
    private readonly testnet: boolean;

    private readonly decimals = 8;

    constructor(privateKey: string, network: string) {
        this.testnet = network !== "mainnet";
        this.privateKey = BitgoUTXOLib.loadPrivateKey(this._bitgoNetwork(), privateKey);
    }

    // Returns whether or not this can handle the asset
    public readonly handlesAsset = (asset: Asset): boolean =>
        ["BCH", "BITCOIN CASH", "BCASH", "BITCOINCASH", "BITCOIN-CASH"].indexOf(asset.toUpperCase()) !== -1;

    public readonly address = async (asset: Asset, options?: AddressOptions): Promise<string> =>
        toCashAddress(this.privateKey.getAddress());

    // Balance
    public readonly balanceOf = async (asset: Asset, options?: BalanceOptions): Promise<BigNumber> =>
        (await this.balanceOfInSats(asset, options)).dividedBy(
            new BigNumber(10).exponentiatedBy(this.decimals)
        );

    public readonly balanceOfInSats = async (asset: Asset, options?: BalanceOptions): Promise<BigNumber> => {
        const utxos = await this._getUTXOs(asset, options);
        return utxos.reduce((sum, utxo) => sum.plus(utxo.value), new BigNumber(0));
    };

    // Transfer
    public readonly send = (
        to: string,
        value: BigNumber,
        asset: Asset,
        options?: TxOptions
    ): PromiEvent<string> =>
        this.sendSats(
            to,
            value.times(new BigNumber(10).exponentiatedBy(this.decimals)),
            asset,
            options
        );

    public readonly sendSats = (
        to: string,
        valueIn: BigNumber,
        asset: Asset,
        options?: TxOptions
    ): PromiEvent<string> => {
        const promiEvent = newPromiEvent<string>();

        let txHash: string;
        let errored: boolean;

        (async () => {
            const fromAddress = toLegacyAddress(await this.address(asset));
            const toAddress = toLegacyAddress(to);
            const changeAddress = fromAddress;
            const utxos = List(await this._getUTXOs(asset, { ...options, address: fromAddress })).sortBy(utxo => utxo.value).reverse().toArray();

            const built = await BitgoUTXOLib.buildUTXO(
                this._bitgoNetwork(),
                // tslint:disable-next-line: no-bitwise
                this.privateKey, changeAddress, toAddress, valueIn, utxos, { ...options, signFlag: bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_BITCOINCASHBIP143 },
            );

            txHash = await fallback([
                () => BitcoinDotCom.broadcastTransaction(this.testnet)(built.toHex()),
            ]);

            promiEvent.emit('transactionHash', txHash);
            promiEvent.resolve(txHash);
        })().catch((error) => { errored = true; promiEvent.reject(error) });

        subscribeToConfirmations(
            promiEvent,
            () => errored,
            async () => txHash ? BitcoinDotCom.fetchConfirmations(this.testnet)(txHash) : 0,
        )

        return promiEvent;
    };

    private readonly _getUTXOs = async (asset: Asset, options?: { address?: string, confirmations?: number }): Promise<readonly UTXO[]> => {
        const address = toCashAddress(options && options.address || await this.address(asset));
        const confirmations = options && options.confirmations !== undefined ? options.confirmations : 0;

        const endpoints = [
            () => BitcoinDotCom.fetchUTXOs(this.testnet)(address, confirmations),
            () => Sochain.fetchUTXOs(this.testnet ? "BTCTEST" : "BTC")(address, confirmations),
        ];
        return fallback(endpoints);
    };

    private readonly _bitgoNetwork = () => this.testnet ? bitcoin.networks.bitcoincashTestnet : bitcoin.networks.bitcoincash;
}
