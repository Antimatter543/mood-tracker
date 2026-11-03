/**
 * Async test helpers.
 *
 *   const save = deferred();
 *   onSubmit.mockReturnValue(save.promise);   // the write is now "in flight"
 *   ...assert the in-flight state...
 *   await act(async () => save.resolve());     // let it land
 */

export type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
};

/** A promise the test settles by hand, to hold an async operation open. */
export function deferred<T = void>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
