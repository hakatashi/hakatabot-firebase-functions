module.exports = {
	extends: '@hakatashi/eslint-config/typescript',
	plugins: [
		'canonical',
	],
	rules: {
		'import/prefer-default-export': 'off',
		camelcase: 'off',
		'no-unused-vars': 'off',
		'no-dupe-class-members': 'off',
		'import/default': 'off',
		'import/no-namespace': 'off',
		'@typescript-eslint/ban-ts-comment': 'off',
		'@typescript-eslint/no-explicit-any': 'warn',
		'canonical/require-extension': 'error',
	},
};
