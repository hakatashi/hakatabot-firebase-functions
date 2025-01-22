import unicodeNames from '@unicode/unicode-14.0.0/Names/index.js';
import download from 'download';
import emojiData from 'emoji-data';
import {info as logInfo} from 'firebase-functions/logger';
import {defineList, defineString} from 'firebase-functions/params';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import inRange from 'lodash/inRange.js';
import sample from 'lodash/sample.js';
import {webClient as slack} from '../slack.js';
import {getWaka} from './lib/waka.js';

const URLS_TWEETS_JSON = defineString('URLS_TWEETS_JSON');
const SLACK_TOKENS = defineList('SLACK_TOKENS');

const derivedNames = [
	{start: 0x3400, end: 0x4DB5},
	{start: 0x4E00, end: 0x9FEA},
	{start: 0xF900, end: 0xFA6D},
	{start: 0xFA70, end: 0xFAD9},
	{start: 0x17000, end: 0x187EC},
	{start: 0x1B170, end: 0x1B2FB},
	{start: 0x20000, end: 0x2A6D6},
	{start: 0x2A700, end: 0x2B734},
	{start: 0x2B740, end: 0x2B81D},
	{start: 0x2B820, end: 0x2CEA1},
	{start: 0x2CEB0, end: 0x2EBE0},
	{start: 0x2F800, end: 0x2FA1D},
	{start: 0x30000, end: 0x3134F},
];

const unicodes = [...unicodeNames.entries()].filter(([codepoint, name]) => {
	if (name.includes('Private Use')) {
		return false;
	}

	if (name.includes('Hangul Syllable')) {
		return false;
	}

	for (const {start, end} of derivedNames) {
		if (inRange(codepoint, start, end + 1)) {
			return false;
		}
	}

	return true;
});

export const updateSlackStatusesCronJob = onSchedule('every 10 minutes', async () => {
	logInfo('updateSlackStatusesCronJob started');

	const tweetsBuffer = await download(URLS_TWEETS_JSON.value());
	const tweets = JSON.parse(tweetsBuffer.toString());
	const statusText = sample(tweets).replace(/\n/g, '　');

	const emojis = emojiData.all();
	const slackTokens = SLACK_TOKENS.value().map((token) => token.split(':'));

	for (const [, token] of slackTokens) {
		const {team} = await slack.team.info({token});
		logInfo(`Updating status for team ${team?.name}...`);

		const {emoji: customEmojis} = await slack.emoji.list({token});
		const totalEmojis = [
			...emojis.map((em) => em.short_name),
			...Object.keys(customEmojis!),
		];

		const statusEmoji = `:${sample(totalEmojis)}:`;

		const waka = await getWaka();
		const [unicodePoint, unicodeName] = sample(unicodes)!;
		const name = `U-${unicodePoint.toString(16).toUpperCase().padStart(4, '0')} ${unicodeName}`;

		logInfo(`New status: ${statusEmoji} ${statusText}`);
		logInfo(`New title: ${waka}`);
		logInfo(`New name: ${name}`);

		await slack.users.profile.set({
			token,
			profile: {
				title: waka,
				status_text: statusText,
				status_emoji: statusEmoji,
				real_name: name,
			},
		});
	}
});
