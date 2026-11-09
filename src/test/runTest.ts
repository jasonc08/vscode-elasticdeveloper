'use strict';

// Downloads a VS Code build and runs the extension tests inside its extension host.
// Replaces the removed `node ./node_modules/vscode/bin/test` script.

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {

    try {
        // The folder containing the extension's package.json
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The compiled test runner (out/test/index.js)
        const extensionTestsPath = path.resolve(__dirname, './index');

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--disable-extensions']
        });

    } catch(ex) {
        console.error('Failed to run tests', ex);
        process.exit(1);
    }
}

main();
