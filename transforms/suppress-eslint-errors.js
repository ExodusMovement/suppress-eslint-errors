const { createRequire } = require('module');
const path = require('path');

const workingDirectoryRequire = createRequire(path.resolve(process.cwd(), 'index.js'));
const { CLIEngine, ESLint } = workingDirectoryRequire('eslint');

const eslintDisableRegexp = /^\s*eslint-disable(?:-next)?-line(\s|$)(.*)/;

function runEslint(configuration, source, path) {
	const options = {
		baseConfig: configuration ? JSON.parse(configuration) : null,
	};

	// Prior to version 8, ESLint exported an object called CLIEngine that provided
	// the core service.
	if (CLIEngine) {
		return Promise.resolve(new CLIEngine(options).executeOnText(source, path)).results;
	}

	return new ESLint(options).lintText(source, { filePath: path });
}

module.exports = async function codeMod(file, api, options) {
	const results = await runEslint(options.baseConfig, file.source, file.path);

	if (!results || !results[0] || !results[0].messages) {
		return;
	}

	const targets = results[0].messages
		.filter(({ ruleId, severity }) => ruleId && severity >= 2)
		.map(({ ruleId, line }) => ({
			ruleId,
			targetLine: line,
		}));

	if (!targets.length) {
		return;
	}

	const result = api.j(file.source);

	const commentText =
		options && options.message
			? options.message
			: 'TODO: Fix this the next time the file is edited.';

	const ruleIdWhitelist = (options.rules || '').split(',').filter((x) => x);
	const ruleIdWhitelistSet = ruleIdWhitelist.length ? new Set(ruleIdWhitelist) : null;

	for (const { targetLine, ruleId } of targets) {
		if (ruleIdWhitelistSet && !ruleIdWhitelistSet.has(ruleId)) {
			continue;
		}

		const pathsStartingOnLine = result
			.find('Node', (node) => node.loc && node.loc.start.line === targetLine)
			.paths();

		const firstPathOnLine =
			pathsStartingOnLine.find((path) => path.node.loc.end.line === targetLine) ||
			pathsStartingOnLine[0];

		if (!firstPathOnLine) {
			api.report(
				`Unable to find any nodes on line ${targetLine} of ${file.path}. Skipping suppression of ${ruleId}`
			);

			continue;
		}

		addDisableComment({
			filePath: file.path,
			api,
			commentText,
			targetLine,
			ruleId,
			path: firstPathOnLine,
			options,
		});
	}

	return result.toSource();
};

function addDisableComment({
	filePath,
	api,
	commentText,
	targetLine,
	ruleId,
	path,
	options: { inline },
}) {
	let targetPath = path;
	while (
		targetPath.parent &&
		(!targetPath.parent.node.loc || targetPath.parent.node.loc.start.line === targetLine)
	) {
		targetPath = targetPath.parent;
	}

	if (
		targetPath.parent &&
		targetPath.parent.value.type === 'IfStatement' &&
		targetPath.parent.value.alternate === targetPath.value &&
		targetPath.parent.value.consequent.type === 'BlockStatement'
	) {
		const ifStatement = targetPath.parent.value;

		const { consequent } = ifStatement;
		const consequentBody = consequent.body;

		if (consequentBody.length === 0) {
			if (tryRewriteEslintDisable(consequent.innerComments, ruleId)) {
				return;
			}

			consequentBody.push(api.j.noop());
		}

		const lastStatement = consequentBody[consequentBody.length - 1];

		if (tryRewriteEslintDisable(lastStatement.trailingComments, ruleId)) {
			return;
		}

		if (!lastStatement.comments) {
			lastStatement.comments = [];
		}

		if (!lastStatement.trailingComments) {
			lastStatement.trailingComments = [];
		}

		const newComments = [
			createTrailingComment(api, ` eslint-disable-next-line ${ruleId} -- ${commentText}`),
		];

		lastStatement.comments.push(...newComments);
		lastStatement.trailingComments.push(...newComments);

		return;
	}

	if (targetPath.node.type === 'JSXClosingElement') {
		const { children } = targetPath.parent.value;

		if (tryRewriteJsxEslintDisable(children, children.length, ruleId)) {
			return;
		}

		children.push(createJsxComment(api, `eslint-disable-next-line ${ruleId} -- ${commentText}`));
		children.push(api.j.jsxText('\n'));

		return;
	}

	if (targetPath.node.type === 'JSXAttribute') {
		createNormalComment({ api, ruleId, commentText, targetNode: targetPath.value, inline });

		return;
	}

	if (targetPath.parent && targetPath.parent.node.type === 'JSXExpressionContainer') {
		createNormalComment({ api, ruleId, commentText, targetNode: targetPath.value, inline });

		return;
	}

	if (targetPath.parent && targetPath.parent.node.type.substr(0, 3) === 'JSX') {
		if (!targetPath.parent.value.children) {
			api.report(`Skipping suppression of violation of ${ruleId} on ${targetLine} of ${filePath}`);
			return;
		}

		const { children } = targetPath.parent.value;

		// jscodeshift has some bugs around how it handles JSXText nodes that can cause
		// it to swallow significant whitespace. Creating whitespace only nodes appears to
		// solve the issue.
		for (let siblingIndex = children.length - 1; siblingIndex >= 0; siblingIndex--) {
			const sibling = children[siblingIndex];
			if (sibling.type !== 'JSXText') {
				continue;
			}

			if (sibling.value[0] === '\n' && sibling.value.trim().length === 0) {
				continue;
			}

			const lines = sibling.value.split('\n');
			const segments = lines.flatMap((line, lineIndex) => {
				const result = [];

				const trimmedLine = line.trimEnd();
				if (trimmedLine.length !== 0) {
					if (lineIndex === 0) {
						const startTrimmedLine = trimmedLine.trimStart();
						if (startTrimmedLine.length === line.length) {
							result.push(line);
						} else {
							if (startTrimmedLine.length < trimmedLine.length) {
								result.push(trimmedLine.substr(0, trimmedLine.length - startTrimmedLine.length));
							}

							result.push(startTrimmedLine);

							if (trimmedLine.length < line.length) {
								result.push(line.substr(trimmedLine.length));
							}
						}
					} else {
						if (trimmedLine.length === line.length) {
							result.push(line);
						} else {
							result.push(trimmedLine, line.substr(trimmedLine.length));
						}
					}
				}

				if (lineIndex != lines.length - 1) {
					result.push('\n');
				}

				return result;
			});

			children.splice(siblingIndex, 1, ...segments.map((segment) => api.j.jsxText(segment)));
		}

		let targetIndex = children.indexOf(targetPath.value);
		for (let siblingIndex = targetIndex - 1; siblingIndex >= 0; siblingIndex--) {
			const sibling = children[siblingIndex];
			if (sibling.type === 'JSXText') {
				if (sibling.value.indexOf('\n') !== -1) {
					break;
				}

				targetIndex = siblingIndex;
			} else if (sibling.loc) {
				if (sibling.loc.start.line !== targetLine) {
					break;
				}

				targetIndex = siblingIndex;
			}
		}

		if (tryRewriteJsxEslintDisable(children, targetIndex, ruleId)) {
			return;
		}

		const previousSibling = children[targetIndex - 1];

		if (previousSibling && previousSibling.type === 'JSXText') {
			const textValue = previousSibling.value;
			const lastNewline = textValue.lastIndexOf('\n');
			if (
				lastNewline !== textValue.length - 1 &&
				textValue.substr(lastNewline + 1).trim().length === 0
			) {
				previousSibling.value = textValue.substr(0, lastNewline);
				children.splice(targetIndex, 0, api.j.jsxText(textValue.substr(lastNewline)));
				targetIndex++;
			}
		}

		children.splice(
			targetIndex,
			0,
			createJsxComment(api, `eslint-disable-next-line ${ruleId} -- ${commentText}`),
			api.j.jsxText('\n')
		);

		return;
	}

	createNormalComment({ api, ruleId, commentText, targetNode: targetPath.value, inline });
}

const inlineComment = {
	disable: 'eslint-disable-line',
	leading: false,
	trailing: true,
};

const leadingComment = {
	disable: 'eslint-disable-next-line',
	leading: true,
	trailing: false,
};

function createNormalComment({ api, ruleId, commentText, targetNode, inline }) {
	if (tryRewriteEslintDisable(targetNode.leadingComments, ruleId)) {
		return;
	}

	if (tryRewriteEslintDisable(targetNode.trailingComments, ruleId)) {
		return;
	}

	if (!targetNode.comments) {
		targetNode.comments = [];
	}

	if (!targetNode.leadingComments) {
		targetNode.leadingComments = [];
	}

	const { disable, ...commentProperties } = inline ? inlineComment : leadingComment;
	const comment = api.j.line(` ${disable} ${ruleId} -- ${commentText}`);
	Object.assign(comment, commentProperties);

	targetNode.comments.push(comment);
}

function tryRewriteJsxEslintDisable(children, targetIndex, ruleId) {
	let currentIndex = targetIndex - 1;

	while (currentIndex >= 0) {
		const sibling = children[currentIndex];
		if (sibling.type === 'JSXText' && sibling.value.trim().length === 0) {
			currentIndex--;
		} else {
			if (
				sibling.type === 'JSXExpressionContainer' &&
				sibling.expression.type === 'JSXEmptyExpression' &&
				tryRewriteEslintDisable(sibling.expression.comments, ruleId)
			) {
				return true;
			}

			return false;
		}
	}

	return false;
}

function tryRewriteEslintDisable(comments, ruleId) {
	if (!comments || !comments.length) {
		return false;
	}

	const lastComment = comments[comments.length - 1];

	const match = lastComment.value.match(eslintDisableRegexp);
	if (!match) {
		return false;
	}

	const [ruleDetails, ...explanationParts] = match[2].split('--');

	const disabledRules = ruleDetails.split(',').map((x) => x.trim());
	if (!disabledRules.length || disabledRules.includes(ruleId)) {
		return true;
	}

	const explanationSuffix = explanationParts.length
		? ` -- ${explanationParts.join('--').trim()}`
		: '';

	const disable = match[0].split(' ')[1];

	lastComment.value = ` ${disable} ${disabledRules.join(', ')}, ${ruleId}${explanationSuffix}`;

	if (lastComment.type === 'CommentBlock') {
		lastComment.value += ' ';
	}

	return true;
}

// Using the builder methods to generate a jsx comment expression
// results in newlines in weird places. Parsing the exact strings that
// we want, however, produces the desired output.
function createJsxComment(api, text) {
	// The <element> around the curly braces causes this to be parsed as a JSXExpressionContainer
	// instead of as a BlockExpression.
	const expressionContainer = api.j(`<element>{/* a comment */}</element>`).paths()[0].value.program
		.body[0].expression.children[0];

	expressionContainer.expression.innerComments[0].value = ` ${text} `;

	return expressionContainer;
}

// Using the builder methods to generate trailing comments results
// in comments without preceding newlines. However, parsing a small
// module containing a trailing comment with a preceding newline will
// generate a node with the necessary properties.
function createTrailingComment(api, text) {
	const comment = api
		.j(
			`statement();
// trailing comment`
		)
		.paths()[0].value.program.body[0].comments[0];

	comment.value = text;

	return comment;
}
