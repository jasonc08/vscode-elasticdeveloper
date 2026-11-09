'use strict';

// Test runner entry point used by @vscode/test-electron.
//
// The old runner imported `vscode/lib/testrunner`, which only exists in the
// ancient `vscode` npm package and is not shipped by modern VS Code. Mocha is
// driven directly instead.

import * as path from 'path';
import Mocha = require('mocha');
import { glob } from 'glob';

export function run(): Promise<void> {

    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 10000
    });

    const testsRoot = path.resolve(__dirname);

    return new Promise<void>((resolve, reject) => {

        glob('**/**.test.js', { cwd: testsRoot })
            .then((files) => {
                files.forEach((file) => mocha.addFile(path.resolve(testsRoot, file)));

                try {
                    mocha.run((failures) => {
                        if(failures > 0) {
                            reject(new Error(failures + ' tests failed.'));
                        } else {
                            resolve();
                        }
                    });
                } catch(ex) {
                    reject(ex);
                }
            })
            .catch((ex) => reject(ex));
    });
}
