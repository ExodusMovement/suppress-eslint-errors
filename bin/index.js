#!/usr/bin/env node

// This must be performed before anything else in order for
// please-upgrade-node to work properly.
const pkg = require('../package.json');
require('please-upgrade-node')(pkg);

const fs = require('fs');
const { createRequire } = require('module');
const path = require('path');
const spawn = require('cross-spawn');

const workingDirectoryRequire = createRequire(path.resolve(process.cwd(), 'index.js'));

const chalkImport = import('chalk');

async function logWarning(...args) {
	const { default: chalk } = await chalkImport;
	console.warn(chalk.yellow(...args));
}

async function logError(...args) {
	const { default: chalk } = await chalkImport;
	console.error(chalk.red(...args));
}

try {
	workingDirectoryRequire('eslint');
} catch (x) {
	Promise.all([
		logError('eslint was not found.'),
		logError('suppress-eslint-errors requires eslint to be installed in the working directory.'),
	]).finally(() => process.exit(1));
}

const jscodeshiftPath = require.resolve('jscodeshift/bin/jscodeshift');
const transformPath = require.resolve('../transforms/suppress-eslint-errors');

const ignoreFiles = ['.eslintignore', '.gitignore'];

async function getIgnoreConfig() {
	for (const ignoreFile of ignoreFiles) {
		const filePath = path.resolve(process.cwd(), ignoreFile);
		if (!fs.existsSync(filePath)) {
			continue;
		}

		const allLines = fs.readFileSync(filePath, { encoding: 'utf8' }).split('\n');
		if (allLines.findIndex((line) => line.startsWith('!')) !== -1) {
			await logWarning(
				`your ${ignoreFile} contains exclusions, which jscodeshift does not properly support.`
			);
			await logWarning('skipping the ignore-config option.');

			return [];
		}

		return [`--ignore-config=${ignoreFile}`];
	}

	return [];
}

(async function runJsCodeShift() {
	const result = spawn.sync(
		'node',
		[
			jscodeshiftPath,
			'--no-babel',
			'-t',
			transformPath,
			...(await getIgnoreConfig()),
			...process.argv.slice(2),
		],
		{
			stdio: 'inherit',
		}
	);

	if (result.signal) {
		if (result.signal === 'SIGKILL') {
			console.error(
				'The script failed because the process exited too early. ' +
					'This probably means the system ran out of memory or someone called ' +
					'`kill -9` on the process.'
			);
		} else if (result.signal === 'SIGTERM') {
			console.error(
				'The script failed because the process exited too early. ' +
					'Someone might have called `kill` or `killall`, or the system could ' +
					'be shutting down.'
			);
		}
		process.exit(1);
	}

	process.exit(result.status);
})();
