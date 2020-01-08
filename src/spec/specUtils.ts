import { ExecutionContext } from "ava";

// import { List } from "immutable";

export const testEndpoints = async (t: ExecutionContext<unknown>, endpoints: ReadonlyArray<undefined | (() => Promise<any>)>) => {
    let expectedResult = null;
    for (const endpoint of endpoints) {
        if (!endpoint) { continue; }
        const result = await endpoint();
        // try {
        //     if (Array.isArray(result)) {
        //         result = List(result).sortBy(x => x.txid).toArray();
        //     }
        // } catch (error) {
        //     // ignore error
        // }
        expectedResult = expectedResult || result;
        t.deepEqual(expectedResult, result);
    }
};
