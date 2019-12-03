import * as bitcoin from "bitgo-utxo-lib";

import BigNumber from "bignumber.js";
import { List } from "immutable";

import { Blockstream } from "../../common/apis/blockstream";
import { Sochain } from "../../common/apis/sochain";
import { BitgoUTXOLib } from "../../common/libraries/bitgoUtxoLib";
import { subscribeToConfirmations } from "../../lib/confirmations";
import { UTXO } from "../../lib/mercury";
import { newPromiEvent, PromiEvent } from "../../lib/promiEvent";
import { fallback } from "../../lib/retry";
import { Asset, Handler } from "../../types/types";

interface AddressOptions { }
interface BalanceOptions extends AddressOptions {
    address?: string;
    confirmations?: number; // defaults to 0
}
interface TxOptions extends BalanceOptions {
    fee?: number;           // defaults to 10000
    subtractFee?: boolean;  // defaults to false
}

export class BTCHandler implements Handler {
    private readonly privateKey: { getAddress: () => string; };
    private readonly testnet: boolean;

    private readonly decimals = 8;

    constructor(privateKey: string, network: string) {
        this.testnet = network !== "mainnet";
        this.privateKey = BitgoUTXOLib.loadPrivateKey(this.testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin, privateKey);
    }

    // Returns whether or not this can handle the asset
    public readonly handlesAsset = (asset: Asset): boolean =>
        typeof asset === "string" && ["BTC", "BITCOIN"].indexOf(asset.toUpperCase()) !== -1;

    public readonly address = async (asset: Asset, options?: AddressOptions): Promise<string> =>
        this.privateKey.getAddress();

    // Balance
    public readonly getBalance = async (asset: Asset, options?: BalanceOptions): Promise<BigNumber> =>
        (await this.getBalanceInSats(asset, options)).dividedBy(
            new BigNumber(10).exponentiatedBy(this.decimals)
        );

    public readonly getBalanceInSats = async (asset: Asset, options?: BalanceOptions): Promise<BigNumber> => {
        const utxos = await getUTXOs(this.testnet, { ...options, address: options && options.address || await this.address(asset) });
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
            const fromAddress = await this.address(asset);
            const changeAddress = fromAddress;
            const utxos = List(await getUTXOs(this.testnet, { ...options, address: fromAddress })).sortBy(utxo => utxo.value).reverse().toArray();

            const built = await BitgoUTXOLib.buildUTXO(
                this.testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
                this.privateKey, changeAddress, to, valueIn, utxos, options,
            );

            txHash = await fallback([
                () => Blockstream.broadcastTransaction(this.testnet)(built.toHex()),
                () => Sochain.broadcastTransaction(this.testnet ? "BTCTEST" : "BTC")(built.toHex()),
            ]);

            promiEvent.emit('transactionHash', txHash);
            promiEvent.resolve(txHash);
        })().catch((error) => { errored = true; promiEvent.reject(error) });

        subscribeToConfirmations(
            promiEvent,
            () => errored,
            async () => txHash ? Blockstream.fetchConfirmations(this.testnet)(txHash) : 0,
        )

        return promiEvent;
    };
}

export const getUTXOs = async (testnet: boolean, options: { address: string, confirmations?: number }): Promise<readonly UTXO[]> => {
    const confirmations = options && options.confirmations !== undefined ? options.confirmations : 0;

    const endpoints = [
        () => Blockstream.fetchUTXOs(testnet)(options.address, confirmations),
        () => Sochain.fetchUTXOs(testnet ? "BTCTEST" : "BTC")(options.address, confirmations),
    ];
    return fallback(endpoints);
};