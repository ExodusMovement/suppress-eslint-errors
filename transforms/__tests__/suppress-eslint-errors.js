const path = require('path');
const jscodeshift = require('jscodeshift');
const codeMod = require('../suppress-eslint-errors');

test('inserts a new comment in javascript', async () => {
	const program = `export function foo(a, b) {
  return a == b;
}
`;

	await expect(modifySource(program)).resolves.toBe(`export function foo(a, b) {
  // eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited.
  return a == b;
}
`);
});

test("doesn't update unnecessarily", async () => {
	const program = `export function foo(a, b) {
  // eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited.
  return a == b;
}
`;

	await expect(modifySource(program)).resolves.toBe(undefined);
});

test('inserts a new comment in jsx', async () => {
	const program = `export function Component({ a, b }) {
  return (
    <div>
      <div>{a == b}</div>
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a, b }) {
  return (
    (<div>
      {/* eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited. */}
      <div>{a == b}</div>
    </div>)
  );
}`);
});

test('updates an existing comment in javascript', async () => {
	const program = `export function foo(a, b) {
  // eslint-disable-next-line eqeqeq
  const bar = a == b;
}
`;

	await expect(modifySource(program)).resolves.toBe(`export function foo(a, b) {
  // eslint-disable-next-line eqeqeq, no-unused-vars
  const bar = a == b;
}
`);
});

test('updates an existing comment with an explanation in javascript', async () => {
	const program = `export function foo(a, b) {
  // eslint-disable-next-line eqeqeq -- for reasons
  const bar = a == b;
}
`;

	await expect(modifySource(program)).resolves.toBe(`export function foo(a, b) {
  // eslint-disable-next-line eqeqeq, no-unused-vars -- for reasons
  const bar = a == b;
}
`);
});

test('updates an existing comment in jsx', async () => {
	const program = `export function Component({ a }) {
  return (
    <div>
      {/* eslint-disable-next-line eqeqeq */}
      <div>{a == c}</div>
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a }) {
  return (
    (<div>
      {/* eslint-disable-next-line eqeqeq, no-undef */}
      <div>{a == c}</div>
    </div>)
  );
}`);
});

test('updates an existing comment with an explanation in jsx', async () => {
	const program = `export function Component({ a }) {
  return (
    <div>
      {/* eslint-disable-next-line eqeqeq -- for reasons */}
      <div>{a == c}</div>
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a }) {
  return (
    (<div>
      {/* eslint-disable-next-line eqeqeq, no-undef -- for reasons */}
      <div>{a == c}</div>
    </div>)
  );
}`);
});

test('inserts comments above a closing tag', async () => {
	const program = `export function Component({ a, b }) {
  return (
    <div>
      <div>
      </div>{a == b}
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a, b }) {
  return (
    (<div>
      <div>
        {/* eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited. */}
      </div>{a == b}
    </div>)
  );
}`);
});

test('updates comments above a closing tag', async () => {
	const program = `export function Component({ a }) {
  return (
    <div>
      <div>
        {/* eslint-disable-next-line eqeqeq */}
      </div>{a == c}
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a }) {
  return (
    (<div>
      <div>
        {/* eslint-disable-next-line eqeqeq, no-undef */}
      </div>{a == c}
    </div>)
  );
}`);
});

test('supports adding comments to JSX attributes', async () => {
	const program = `export function Component({ a, b }) {
    return (
      <div
        prop={a == b ? a : b}>
      </div>
    );
  }`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a, b }) {
    return (
      (<div
        // eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited.
        prop={a == b ? a : b}>
      </div>)
    );
  }`);
});

test('supports adding comments to JSX attributes containing markup', async () => {
	const program = `export function Component({ a, b }) {
    return (
      <div
        prop={
          <div prop={a == b ? a : b} />
        }>
      </div>
    );
  }`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a, b }) {
    return (
      (<div
        prop={
          // eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited.
          <div prop={a == b ? a : b} />
        }>
      </div>)
    );
  }`);
});

test('supports alternative messages in javascript', async () => {
	const program = `export function foo(a, b) {
  return a == b;
}
`;

	await expect(modifySource(program, { message: 'Something more informative' })).resolves
		.toBe(`export function foo(a, b) {
  // eslint-disable-next-line eqeqeq -- Something more informative
  return a == b;
}
`);
});

test('supports alternative messages in jsx', async () => {
	const program = `export function Component({ a, b }) {
  return (
    <div>
      <div>{a == b}</div>
    </div>
  );
}`;

	await expect(modifySource(program, { message: 'Something more informative' })).resolves
		.toBe(`export function Component({ a, b }) {
  return (
    (<div>
      {/* eslint-disable-next-line eqeqeq -- Something more informative */}
      <div>{a == b}</div>
    </div>)
  );
}`);
});

test('supports rule whitelist in javascript', async () => {
	const program = `export function foo(a, b) {
  return a == b;
  console.log('unreachable');
}
`;

	await expect(modifySource(program, { rules: 'no-unreachable' })).resolves
		.toBe(`export function foo(a, b) {
  return a == b;
  // eslint-disable-next-line no-unreachable -- TODO: Fix this the next time the file is edited.
  console.log('unreachable');
}
`);
});

test('supports errors on multiline return statements', async () => {
	const program = `export function fn(a, b) {
  if (a) {
    return;
  }

  if (b) {
    return {
      b
    };
  }
}`;

	await expect(modifySource(program, { rules: 'consistent-return' })).resolves
		.toBe(`export function fn(a, b) {
  if (a) {
    return;
  }

  if (b) {
    // eslint-disable-next-line consistent-return -- TODO: Fix this the next time the file is edited.
    return {
      b
    };
  }
}`);
});

test('skips eslint warnings', async () => {
	const program = `export function fn(a) {
  a()
}`;

	await expect(modifySource(program)).resolves.toBe(undefined);
});

test('skips files that eslint cannot parse', async () => {
	const program = `not actually javascript`;

	await expect(modifySource(program)).resolves.toBe(undefined);
});

test('comments named export with correct syntax', async () => {
	const program = `export const Component = (a, b) => {
  return a === b;
}`;

	const baseConfig = { plugins: ['import'], rules: { 'import/prefer-default-export': 'error' } };

	await expect(
		modifySource(program, {
			baseConfig,
		})
	).resolves
		.toBe(`// eslint-disable-next-line import/prefer-default-export -- TODO: Fix this the next time the file is edited.
export const Component = (a, b) => {
  return a === b;
}`);
});

test('does not split JSX lines containing multiple nodes', async () => {
	const program = `export function Component({ a, b }) {
  return (
    <div>
      Some text <span>{a == b}</span>.
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a, b }) {
  return (
    (<div>
      {/* eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited. */}
      Some text <span>{a == b}</span>.
    </div>)
  );
}`);
});

test('handles trailing text on the previous line', async () => {
	const program = `export function Component({ a, b }) {
  return (
    <div>
      <div />Some text
      <span>{a == b}</span>.
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a, b }) {
  return (
    (<div>
      <div />Some text
      {/* eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited. */}
      <span>{a == b}</span>.
    </div>)
  );
}`);
});

test('preserves significant trailing whitespace in jsx text nodes', async () => {
	const program = `export function Component({ a, b }) {
  return (
    <div>
      Some text <span>next to a span</span>
      <span onClick={() => a == b}>hi</span>.
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a, b }) {
  return (
    (<div>
      Some text <span>next to a span</span>
      {/* eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited. */}
      <span onClick={() => a == b}>hi</span>.
    </div>)
  );
}`);
});

test('preserves significant leading whitespace in jsx text nodes', async () => {
	const program = `export function Component({ a, b }) {
  return (
    <div>
      <span>A span</span> next to some text
      <span onClick={() => a == b}>hi</span>.
    </div>
  );
}`;

	await expect(modifySource(program)).resolves.toBe(`export function Component({ a, b }) {
  return (
    (<div>
      <span>A span</span> next to some text
      {/* eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited. */}
      <span onClick={() => a == b}>hi</span>.
    </div>)
  );
}`);
});

test('does not split if from preceding else', async () => {
	const program = `export function foo(a, b) {
  if (a === b) {
    return a;
  } else if (a == b) {
    return b;
  }

  return null;
}`;

	await expect(modifySource(program)).resolves.toBe(`export function foo(a, b) {
  if (a === b) {
    return a;
    // eslint-disable-next-line eqeqeq -- TODO: Fix this the next time the file is edited.
  } else if (a == b) {
    return b;
  }

  return null;
}`);
});

test('correctly modifies comments in else if conditions', async () => {
	const program = `export function foo(a, b) {
  if (a === b) {
    return a;
    // eslint-disable-next-line eqeqeq
  } else if (a == c) {
    return b;
  }

  return null;
}`;

	await expect(modifySource(program)).resolves.toBe(`export function foo(a, b) {
  if (a === b) {
    return a;
    // eslint-disable-next-line eqeqeq, no-undef
  } else if (a == c) {
    return b;
  }

  return null;
}`);
});

test('correctly handles empty blocks with multiple violations in else if conditions', async () => {
	const program = `export function foo(a, b) {
  if (a === b) {
  } else if (a == c) {
    return b;
  }

  return null;
}`;

	await expect(modifySource(program, { rules: 'eqeqeq,no-undef' })).resolves
		.toBe(`export function foo(a, b) {
  if (a === b) {

    // eslint-disable-next-line eqeqeq, no-undef -- TODO: Fix this the next time the file is edited.
  } else if (a == c) {
    return b;
  }

  return null;
}`);
});

test('correctly modifies empty blocks with violations in else if conditions', async () => {
	const program = `export function foo(a, b) {
  if (a === b) {
    // eslint-disable-next-line eqeqeq
  } else if (a == c) {
    return b;
  }

  return null;
}`;

	await expect(modifySource(program, { rules: 'eqeqeq,no-undef' })).resolves
		.toBe(`export function foo(a, b) {
  if (a === b) {
    // eslint-disable-next-line eqeqeq, no-undef
  } else if (a == c) {
    return b;
  }

  return null;
}`);
});

describe('inline comments', () => {
	const options = { inline: true };

	test('inserts a new comment in javascript', async () => {
		const program = `export function foo(a, b) {
  return a == b;
}
`;

		await expect(modifySource(program, options)).resolves.toBe(`export function foo(a, b) {
  return a == b;// eslint-disable-line eqeqeq -- TODO: Fix this the next time the file is edited.
}
`);
	});

	test("doesn't update unnecessarily", async () => {
		const program = `export function foo(a, b) {
  return a == b;// eslint-disable-line eqeqeq -- TODO: Fix this the next time the file is edited.
}
`;

		await expect(modifySource(program, options)).resolves.toBe(undefined);
	});

	test('updates an existing comment in javascript', async () => {
		const program = `export function foo(a, b) {
  // eslint-disable-next-line eqeqeq
  const bar = a == b;
}
`;

		await expect(modifySource(program, options)).resolves.toBe(`export function foo(a, b) {
  // eslint-disable-next-line eqeqeq, no-unused-vars
  const bar = a == b;
}
`);
	});

	test('updates an existing inline comment in javascript', async () => {
		const program = `export function foo(a, b) {
  const bar = a == b;// eslint-disable-line eqeqeq
}
`;

		await expect(modifySource(program, options)).resolves.toBe(`export function foo(a, b) {
  const bar = a == b;// eslint-disable-line eqeqeq, no-unused-vars
}
`);
	});

	test('updates an existing comment with an explanation in javascript', async () => {
		const program = `export function foo(a, b) {
  // eslint-disable-next-line eqeqeq -- for reasons
  const bar = a == b;
}
`;

		await expect(modifySource(program, options)).resolves.toBe(`export function foo(a, b) {
  // eslint-disable-next-line eqeqeq, no-unused-vars -- for reasons
  const bar = a == b;
}
`);
	});

	test('updates an existing inline comment with an explanation in javascript', async () => {
		const program = `export function foo(a, b) {
  const bar = a == b;// eslint-disable-line eqeqeq -- for reasons
}
`;

		await expect(modifySource(program, options)).resolves.toBe(`export function foo(a, b) {
  const bar = a == b;// eslint-disable-line eqeqeq, no-unused-vars -- for reasons
}
`);
	});

	test('supports alternative messages in javascript', async () => {
		const program = `export function foo(a, b) {
  return a == b;
}
`;

		await expect(modifySource(program, { ...options, message: 'Something more informative' }))
			.resolves.toBe(`export function foo(a, b) {
  return a == b;// eslint-disable-line eqeqeq -- Something more informative
}
`);
	});

	test('supports rule whitelist in javascript', async () => {
		const program = `export function foo(a, b) {
  return a == b;
  console.log('unreachable');
}
`;

		await expect(modifySource(program, { ...options, rules: 'no-unreachable' })).resolves
			.toBe(`export function foo(a, b) {
  return a == b;
  console.log('unreachable');// eslint-disable-line no-unreachable -- TODO: Fix this the next time the file is edited.
}
`);
	});

	test('supports errors on multiline return statements', async () => {
		const program = `export function fn(a, b) {
  if (a) {
    return;
  }

  if (b) {
    return {
      b
    };
  }
}`;

		await expect(modifySource(program, { ...options, rules: 'consistent-return' })).resolves
			.toBe(`export function fn(a, b) {
  if (a) {
    return;
  }

  if (b) {
    return {
      b
    };// eslint-disable-line consistent-return -- TODO: Fix this the next time the file is edited.
  }
}`);
	});
});

const defaultPath = path.resolve(__dirname, 'examples', 'index.js');
async function modifySource(source, options) {
	const transformOptions = { ...options };
	if (transformOptions.baseConfig) {
		transformOptions.baseConfig = JSON.stringify(transformOptions.baseConfig);
	}

	const result = await codeMod(
		{
			source,
			path: defaultPath,
		},
		{ jscodeshift, j: jscodeshift, report: console.log },
		transformOptions
	);

	return result ? result.replace(/\r\n/g, '\n') : result;
}
