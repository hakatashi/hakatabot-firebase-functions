import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

interface EmojibaseEntry {
	hexcode: string,
	emoji: string,
}

type ShortcodeMap = Record<string, string | string[]>;

const SKIN_TONES: Record<string, string> = {
	'skin-tone-2': '\u{1F3FB}',
	'skin-tone-3': '\u{1F3FC}',
	'skin-tone-4': '\u{1F3FD}',
	'skin-tone-5': '\u{1F3FE}',
	'skin-tone-6': '\u{1F3FF}',
};

let shortcodeToEmoji: Map<string, string> | null = null;

const getShortcodeMap = () => {
	if (shortcodeToEmoji !== null) {
		return shortcodeToEmoji;
	}

	const entries: EmojibaseEntry[] = require('emojibase-data/en/data.json');
	const hexToEmoji = new Map(entries.map((entry) => [entry.hexcode, entry.emoji]));

	shortcodeToEmoji = new Map();
	// Earlier presets take precedence: iamcal is the set Slack's names are based on
	for (const preset of ['iamcal', 'github']) {
		const shortcodes: ShortcodeMap = require(`emojibase-data/en/shortcodes/${preset}.json`);
		for (const [hexcode, names] of Object.entries(shortcodes)) {
			const emoji = hexToEmoji.get(hexcode);
			if (emoji === undefined) {
				continue;
			}
			for (const name of [names].flat()) {
				if (!shortcodeToEmoji.has(name)) {
					shortcodeToEmoji.set(name, emoji);
				}
			}
		}
	}

	return shortcodeToEmoji;
};

// Replace Slack-style emoji codes (`:blush:`) with Unicode emoji. Codes that
// are not standard Unicode emoji (e.g. custom workspace emoji) are left as-is.
export const convertSlackEmoji = (text: string) => (
	text.replace(/:(?<name>[^\s:]+):(?::(?<tone>skin-tone-[2-6]):)?/g, (match, name: string, tone: string | undefined) => {
		const emoji = getShortcodeMap().get(name);
		if (emoji === undefined) {
			return match;
		}
		if (tone === undefined) {
			return emoji;
		}
		// Insert the modifier after the base code point (before any VS16/ZWJ sequence)
		const [base, ...rest] = [...emoji].filter((char) => char !== '️');
		return base + SKIN_TONES[tone] + rest.join('');
	})
);
