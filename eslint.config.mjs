import hakatashi from '@hakatashi/eslint-config/typescript.js';
import canonical from 'eslint-plugin-canonical';
import globals from 'globals';

export default [
	...hakatashi,
	{
		languageOptions: {
			globals: {
				...globals.jest,
			},
		},
		plugins: {
			canonical,
		},
		rules: {
			'no-dupe-class-members': 'off',
			'import/prefer-default-export': 'off',
			'import/no-namespace': 'off',
			'canonical/require-extension': 'error',
			'@typescript-eslint/no-explicit-any': 'warn',
			'import/no-named-as-default-member': 'off',
		},
	},
];
