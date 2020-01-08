import test from "ava";

import { testEndpoints } from "../../spec/specUtils";
import { _apiFallbacks } from "./BCHHandler";

// Test address endpoint ///////////////////////////////////////////////////////
const testnetAddress = "bchtest:qqnm45rptzzpvg0dx04erm7mrnz27jvkevem4rjxlg";
const mainnetAddress = "bitcoincash:qqnm45rptzzpvg0dx04erm7mrnz27jvkevaf3ys3c5";
const confirmations = 6;

test("Testnet BCH", testEndpoints, _apiFallbacks.fetchUTXOs(true, testnetAddress, confirmations));
test("Mainnet BCH", testEndpoints, _apiFallbacks.fetchUTXOs(false, mainnetAddress, confirmations));

// Test confirmations endpoint /////////////////////////////////////////////////
const testnetHash = "69f277b26d6192754ac884b69223f0f5212082bf8ede1ab2dbd6b4383fd1d583";
const mainnetHash = "03e29b07bb98b1e964296289dadb2fb034cb52e178cc306d20cc9ddc951d2a31";

test("Testnet BCH confirmations", testEndpoints, _apiFallbacks.fetchConfirmations(true, testnetHash));
test("Mainnet BCH confirmations", testEndpoints, _apiFallbacks.fetchConfirmations(false, mainnetHash));
