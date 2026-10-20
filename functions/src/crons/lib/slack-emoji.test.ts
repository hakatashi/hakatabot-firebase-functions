import {convertSlackEmoji} from './slack-emoji.js';

describe('convertSlackEmoji', () => {
	it('converts standard emoji codes', () => {
		expect(convertSlackEmoji('hello :blush: world')).toBe('hello 😊 world');
		expect(convertSlackEmoji(':+1::thumbsup:')).toBe('👍\uFE0F👍\uFE0F');
	});

	it('leaves unknown codes untouched', () => {
		expect(convertSlackEmoji('foo :custom_emoji: bar')).toBe('foo :custom_emoji: bar');
		expect(convertSlackEmoji('12:30:45')).toBe('12:30:45');
	});

	it('applies skin tone modifiers', () => {
		expect(convertSlackEmoji(':wave::skin-tone-3:')).toBe('👋🏼');
	});
});
