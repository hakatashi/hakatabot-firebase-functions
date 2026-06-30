import path from 'node:path';
import {PubSub} from '@google-cloud/pubsub';
import {createEventAdapter} from '@slack/events-api';
import {WebClient} from '@slack/web-api';
import type {WebAPICallResult, MessageAttachment, KnownBlock} from '@slack/web-api';
import {stripIndents} from 'common-tags';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import download from 'download';
import {Timestamp} from 'firebase-admin/firestore';
import {info as logInfo, error as logError} from 'firebase-functions/logger';
import {defineString} from 'firebase-functions/params';
import {onRequest} from 'firebase-functions/v2/https';
import {google} from 'googleapis';
import range from 'lodash/range.js';
import shuffle from 'lodash/shuffle.js';
import {HAKATASHI_ID, SANDBOX_ID, TSG_SLACKBOT_ID, RANDOM_ID, TSGBOT_ID, SIG_QUIZ_CHANNEL_ID, TSG_EVENTS_CALENDAR_ID} from './const.js';
import {postMastodon} from './crons/lib/social.js';
import {db, MastodonPosts, State, States} from './firestore.js';
import {getGoogleAuth} from './google.js';
import {getThreadMessages} from './slack-patron.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const pubsubClient = new PubSub();

interface ReactionAddedEvent {
	type: 'reaction_added',
	user: string,
	item: {
		type: string,
		channel: string,
		ts: string,
	},
	reaction: string,
	item_user: string,
	event_ts: string,
}

interface Attachment extends MessageAttachment {
	original_url?: string,
	image_url?: string,
	service_name?: string,
}

interface File {
	url_private: string,
	mimetype: string,
}

interface Reaction {
	count: number,
	name: string,
	users: string[],
}

export interface Message {
	type: string,
	subtype: string,
	text: string,
	ts: string,
	channel: string,
	user: string,
	username: string,
	attachments?: Attachment[],
	files?: File[],
	reactions?: Reaction[],
	blocks?: KnownBlock[],
	bot_id?: string,
	thread_ts?: string,
	hidden?: true,
	icons?: {
		emoji?: string,
	},
}

export interface GetMessagesResult extends WebAPICallResult {
	messages: Message[],
}

const SLACK_TOKEN = defineString('SLACK_TOKEN');
const SLACK_SIGNING_SECRET = defineString('SLACK_SIGNING_SECRET');
const IT_QUIZ_DISCORD_EVENT_URL = defineString('IT_QUIZ_DISCORD_EVENT_URL');

const slack = new WebClient(SLACK_TOKEN.value());
const eventAdapter = createEventAdapter(SLACK_SIGNING_SECRET.value(), {waitForResponse: true});

const letterpackEmojis = [
	...range(19).map((i) => `letterpack-${i}`),
	...range(10).map((i) => `letterpack-light-${i}`),
];

// Letterpack bomb
const letterpackBomb = async (event: ReactionAddedEvent) => {
	if (!(event.user === HAKATASHI_ID && event.reaction === 'love_letter')) {
		return;
	}

	await slack.reactions.remove({
		channel: event.item.channel,
		timestamp: event.item.ts,
		name: event.reaction,
	});

	await Promise.all(shuffle(letterpackEmojis).map((emoji) => (
		slack.reactions.add({
			channel: event.item.channel,
			timestamp: event.item.ts,
			name: emoji,
		})
	)));
};

const unescapeSlackComponent = (text: string) => (
	text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
);

// Finds the most recent already-crossposted message among threadMessages
// that precedes beforeTs, so a reply can be posted as a Mastodon self-reply
// and preserve the thread's chronological chain.
const findMastodonReplyTarget = async (threadMessages: Message[], beforeTs: string): Promise<string | null> => {
	const candidates = threadMessages
		.filter((candidate) => parseFloat(candidate.ts) < parseFloat(beforeTs))
		.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));

	for (const candidate of candidates) {
		const post = await MastodonPosts.doc(candidate.ts).get();
		const statusId = post.data()?.statusId;
		if (statusId !== undefined) {
			return statusId;
		}
	}

	return null;
};

// Slack-Mastodon tunnel
const slackMastodonTunnel = async (event: ReactionAddedEvent) => {
	if (event.reaction !== 'red_large_square') {
		return;
	}

	if (!(event.user === HAKATASHI_ID && event.item_user === HAKATASHI_ID)) {
		return;
	}

	// conversations.replies has a tight Slack rate limit, so this goes
	// through the slack-patron caching proxy instead of the Web API client.
	// Unlike the raw Slack API, slack-patron's proxy only resolves the full
	// thread when ts is the thread's parent -- passing a reply's own ts
	// returns just that single message. So fetch the reacted message first,
	// and if it turns out to be a reply, re-fetch using its thread_ts to get
	// every message needed to look up a self-reply target below.
	const initialMessages = await getThreadMessages(event.item.channel, event.item.ts);
	const message = initialMessages.find((candidate) => candidate.ts === event.item.ts);

	if (!message) {
		return;
	}

	const threadMessages = (typeof message.thread_ts === 'string' && message.thread_ts !== message.ts)
		? await getThreadMessages(event.item.channel, message.thread_ts)
		: initialMessages;

	const urls: string[] = [];

	for (const file of message.files ?? []) {
		if (file.mimetype.startsWith('image/')) {
			urls.push(file.url_private);
		}
	}

	const usedUrls = new Set<string>();
	for (const attachment of message.attachments ?? []) {
		if (attachment.image_url && attachment.service_name === 'Gyazo') {
			urls.push(attachment.image_url);
			if (attachment.original_url) {
				usedUrls.add(attachment.original_url);
			}
		}
	}

	const images: {data: Buffer, format: string}[] = [];
	for (const url of urls.slice(0, 4)) {
		const {hostname, pathname} = new URL(url);
		const imageData = await download(url, undefined, {
			headers: {
				...(hostname === 'files.slack.com' ? {Authorization: `Bearer ${SLACK_TOKEN.value()}`} : {}),
			},
		});
		images.push({
			data: imageData,
			format: path.extname(pathname).slice(1),
		});
	}

	// Unescape
	let text = message.text.replace(/<(?<component>.+?)>/g, (_match, component) => {
		const [info, displayText] = component.split('|');
		if ((/^[@#!]/).test(info)) {
			return '';
		}
		if (usedUrls.has(unescapeSlackComponent(info))) {
			return '';
		}
		if (displayText) {
			return displayText;
		}
		return info;
	});
	text = unescapeSlackComponent(text).trim();

	let inReplyToId: string | undefined;
	if (typeof message.thread_ts === 'string' && message.thread_ts !== message.ts) {
		const target = await findMastodonReplyTarget(threadMessages, message.ts);
		if (target !== null) {
			inReplyToId = target;
		}
	}

	try {
		const data = await postMastodon(text, images, inReplyToId);
		logInfo(`Posted Mastodon status ${data.id} for Slack message ${message.ts}`);

		await MastodonPosts.doc(message.ts).set({
			statusId: data.id,
			url: data.url,
			channel: event.item.channel,
			threadTs: message.thread_ts ?? null,
			postedAt: Timestamp.now(),
		});
	} catch (error) {
		logError(`Failed to post Mastodon status: ${error}`);
	}
};

eventAdapter.on('reaction_added', async (event: ReactionAddedEvent) => {
	if (event.item.type === 'message') {
		await letterpackBomb(event);
		await slackMastodonTunnel(event);
	}
});

// Wakaran-penalty
eventAdapter.on('message', async (message: Message) => {
	if (
		message.subtype === 'bot_message' &&
		message.bot_id === TSG_SLACKBOT_ID &&
		message.username === '通りすがりに context free bot の解説をしてくれるおじさん' &&
		message.text.endsWith('わからん') &&
		message?.icons?.emoji === ':man_dancing_2:'
	) {
		await pubsubClient
			.topic('hakatabot')
			.publishMessage({
				data: Buffer.from(JSON.stringify({
					type: 'rinna-meaning',
					word: message.text.split(':')[0],
					ts: message.ts,
				})),
			});
	}
});

// Rinna temperature signal
eventAdapter.on('message', async (message: Message) => {
	if (message.text === 'うなの体温') {
		await pubsubClient
			.topic('hakatabot')
			.publishMessage({
				data: Buffer.from(JSON.stringify({
					type: 'rinna-temperature',
					ts: message.ts,
					channel: message.channel,
				})),
			});
	}
});

// No-Events canceller
eventAdapter.on('message', async (message: Message) => {
	if (
		message.subtype === 'bot_message' &&
		message.channel === RANDOM_ID &&
		message.username === 'TSG' &&
		message.text === 'There are no events today'
	) {
		await slack.chat.delete({
			channel: message.channel,
			ts: message.ts,
		});
	}
});

const rinnaSignalBlockList = [
	'わどう',
	'和同',
	'ソートなぞなぞ',
	'ポッキーゲーム',
	'チンイツクイズ',
	'すし',
	'配牌',
];

const isRinnaSignalBlockList = (text: string) => {
	if (rinnaSignalBlockList.includes(text)) {
		return true;
	}

	if (text.endsWith('ロボット')) {
		return true;
	}

	if (text.endsWith('ロボットバトル')) {
		return true;
	}

	if (text.endsWith('スライドパズル')) {
		return true;
	}

	if (text.endsWith('当てクイズ')) {
		return true;
	}

	if (text.endsWith('占い')) {
		return true;
	}

	if (text.endsWith('将棋')) {
		return true;
	}

	if (text.startsWith('ハイパーロボット')) {
		return true;
	}

	if (text.startsWith('座標')) {
		return true;
	}

	return false;
};

const matchRinnaSignalText = (text: string) => {
	if (text.match(/(?:今言うな|皿洗うか|皿洗うの|三脚たたも)/)) {
		return true;
	}
	if (text.match(/^(?:りんな|うな|うか|うの|たたも)、/)) {
		return true;
	}
	if (text.match(/@(?:りんな|うな|うか|うの|たたも)/)) {
		return true;
	}
	return false;
};

// Rinna signal
eventAdapter.on('message', async (message: Message) => {
	if (
		message.channel !== SANDBOX_ID ||
		typeof message.thread_ts === 'string' ||
		(message.text ?? '').includes('CENSORED') ||
		message.hidden
	) {
		return;
	}

	const normalizedText = (message.text ?? '').normalize('NFKC');

	await db.runTransaction(async (transaction) => {
		const state = await transaction.get(States.doc('slack-rinna-signal'));
		const recentBotMessages = (state.get('recentBotMessages') as Message[]) ?? [];
		const recentHumanMessages = (state.get('recentHumanMessages') as Message[]) ?? [];
		const lastSignal = (state.get('lastSignal') as number) ?? 0;
		const optoutUsers = (state.get('optoutUsers') as string[]) ?? [];

		if (
			message.subtype !== 'bot_message' &&
			typeof message.bot_id !== 'string' &&
			message.user !== 'USLACKBOT' &&
			message.user !== TSGBOT_ID
		) {
			if (normalizedText === '@りんな optout') {
				optoutUsers.push(message.user);
				transaction.set(state.ref, {
					optoutUsers: Array.from(new Set(optoutUsers)),
				}, {merge: true});

				await slack.chat.postMessage({
					channel: message.channel,
					text: `<@${message.user}>をオプトアウトしました`,
				});
				return;
			}

			if (normalizedText === '@りんな optin') {
				transaction.set(state.ref, {
					optoutUsers: optoutUsers.filter((user) => user !== message.user),
				}, {merge: true});

				await slack.chat.postMessage({
					channel: message.channel,
					username: '今言うな',
					icon_url: 'https://hakata-public.s3.ap-northeast-1.amazonaws.com/slackbot/una_icon.png',
					text: `にゃにゃにゃ! <@${message.user}>をオプトインしたにゃ!`,
				});
				return;
			}
		}

		// optout
		if (
			typeof message.user === 'string' &&
			optoutUsers.includes(message.user)
		) {
			return;
		}

		const ts = parseFloat(message.ts);
		const threshold = ts - 15 * 60;

		let isTrueHumanMessage = false;
		if (
			message.bot_id === TSG_SLACKBOT_ID &&
			(
				message.username === 'りんな' ||
				message.username === '今言うな' ||
				message.username === '皿洗うか' ||
				message.username === '皿洗うの' ||
				message.username === '三脚たたも'
			)
		) {
			recentHumanMessages.push(message);
		} else if (
			message.subtype === 'bot_message' ||
			typeof message.bot_id === 'string' ||
			message.user === 'USLACKBOT' ||
			message.user === TSGBOT_ID ||
			isRinnaSignalBlockList(normalizedText)
		) {
			recentBotMessages.push(message);
		} else {
			recentHumanMessages.push(message);
			isTrueHumanMessage = true;
		}

		const newBotMessages = recentBotMessages.filter((m) => parseFloat(m.ts) > threshold);
		const newHumanMessages = recentHumanMessages.filter((m) => parseFloat(m.ts) > threshold);

		if (
			(
				isTrueHumanMessage &&
				matchRinnaSignalText(normalizedText)
			) ||
			(
				newHumanMessages.length >= 5 &&
				newBotMessages.length <= newHumanMessages.length / 2 &&
				new Set(newHumanMessages.map(({user}) => user)).size >= 3 &&
				ts >= lastSignal + 60 * 60 &&
				Math.random() < 0.3
			)
		) {
			logInfo(`rinna-signal: Signal triggered on ${ts} (lastSignal = ${lastSignal})`);

			await pubsubClient
				.topic('hakatabot')
				.publishMessage({
					data: Buffer.from(JSON.stringify({
						type: 'rinna-signal',
						botMessages: newBotMessages,
						humanMessages: newHumanMessages,
						lastSignal,
					})),
				});

			transaction.set(state.ref, {
				lastSignal: ts,
			}, {merge: true});
		}

		transaction.set(state.ref, {
			recentBotMessages: newBotMessages,
			recentHumanMessages: newHumanMessages,
		}, {merge: true});
	});
});

interface Moderations {
	google_language_service?: {
		categories: {
			confidence: number,
			name: string,
		}[],
	},
	azure_content_moderator?: {
		terms?: unknown[],
	},
}

// Rinna message information
eventAdapter.on('message', async (message: Message) => {
	if (
		typeof message.thread_ts !== 'string' ||
		message.text !== 'info' ||
		message.subtype === 'bot_message' ||
		typeof message.bot_id === 'string' ||
		message.user === 'USLACKBOT' ||
		message.user === TSGBOT_ID ||
		message.hidden
	) {
		return;
	}

	const queryResult = await db.collection('rinna-responses')
		.where('message.ts', '==', message.thread_ts)
		.get();

	const threadQueryResult = await db.collection('rinna-responses')
		.where('message.message.thread_ts', '==', message.thread_ts)
		.orderBy('message.ts', 'asc')
		.get();

	const resultDocs = [...queryResult.docs, ...threadQueryResult.docs];

	if (resultDocs.length === 0) {
		return;
	}

	const doc = resultDocs[0];

	const inputDialog = doc.get('inputDialog') as string ?? '';
	const outputSpeech = doc.get('outputSpeech') as string ?? '';
	const character = doc.get('character') as string ?? '';
	const moderations = resultDocs.map((resultDoc) => resultDoc.get('moderations') as Moderations ?? {});
	const config = doc.get('config') as Record<string, unknown> ?? {};

	let text = stripIndents`
		Input:
		\`\`\`
		${inputDialog.trim()}
		\`\`\`
		Result:
		\`\`\`
		${character}「${outputSpeech.trim()}」
		\`\`\`
	`;

	for (const moderation of moderations) {
		if (moderation.google_language_service) {
			const isAdult = moderation.google_language_service.categories
				.some((category) => category.name === '/Adult');
			text += '\n';
			text += [
				`Google Moderation Result: ${isAdult ? 'NG' : 'OK'}`,
				'```',
				JSON.stringify(moderation.google_language_service.categories, null, '  '),
				'```',
			].join('\n');
		}

		if (moderation.azure_content_moderator) {
			const terms = moderation.azure_content_moderator.terms ?? [];
			const isOffensive = terms.length > 0;
			text += '\n';
			text += [
				`Azure Moderation Result: ${isOffensive ? 'NG' : 'OK'}`,
				'```',
				JSON.stringify(terms, null, '  '),
				'```',
			].join('\n');
		}
	}

	if (typeof config.thinking_text === 'string') {
		text += `\nThinking Text:\n\`\`\`\n${config.thinking_text}\n\`\`\``;
	}

	await slack.chat.postMessage({
		channel: message.channel,
		thread_ts: message.thread_ts,
		username: 'GPT-2 Messaging Engine Service Rinna',
		text,
	});
});

// FitBit optout
eventAdapter.on('message', async (message: Message) => {
	if (
		!message.text?.startsWith('fitbit ') ||
		message.subtype === 'bot_message' ||
		typeof message.bot_id === 'string' ||
		message.user === 'USLACKBOT' ||
		message.user === TSGBOT_ID ||
		message.hidden
	) {
		return;
	}

	const tokens = message.text.split(' ');

	const operation = tokens[1];
	const user = tokens.slice(2).join(' ');

	const state = new State('sleep-battle-cron-job');
	let optoutUsers = await state.get('optoutUsers', [] as string[]);
	const slackUsers = await state.get('slackUsers', Object.create(null) as Record<string, string>);
	if (operation === 'optin') {
		optoutUsers = optoutUsers.filter((u) => u !== user);
	} else if (operation === 'optout') {
		optoutUsers.push(user);
	} else if (operation === 'id') {
		slackUsers[message.user] = user;
	}

	await state.set({optoutUsers, slackUsers});

	const getNotificationText = () => {
		if (operation === 'optin') {
			return `${user} をオプトインしたよ`;
		}
		if (operation === 'optout') {
			return `${user} をオプトアウトしたよ`;
		}
		if (operation === 'id') {
			return `<@${message.user}> の FitBit id を ${user} に設定したよ`;
		}
		return ':thinking_face:';
	};

	await slack.chat.postMessage({
		channel: message.channel,
		as_user: true,
		text: getNotificationText(),
	});
});

const parseITQuizAnnouncement = (text: string): { hour: number; minute: number; isToday: boolean } | null => {
	if (!text.includes('ITクイズ') || !text.includes('やります')) {
		return null;
	}

	const todayMatch = text.match(/今日(?<hour>\d+)時(?:(?<minute>\d+)分)?から/);
	if (todayMatch?.groups) {
		const hour = parseInt(todayMatch.groups.hour);
		const minute = todayMatch.groups.minute ? parseInt(todayMatch.groups.minute) : 0;
		return {hour, minute, isToday: true};
	}

	const tomorrowMatch = text.match(/明日(?<hour>\d+)時(?:(?<minute>\d+)分)?から/);
	if (tomorrowMatch?.groups) {
		const hour = parseInt(tomorrowMatch.groups.hour);
		const minute = tomorrowMatch.groups.minute ? parseInt(tomorrowMatch.groups.minute) : 0;
		return {hour, minute, isToday: false};
	}

	return null;
};

const addITQuizToCalendar = async (hour: number, minute: number, isToday: boolean): Promise<void> => {
	try {
		const auth = await getGoogleAuth();
		const calendar = google.calendar({version: 'v3', auth});

		let eventDate = dayjs().tz('Asia/Tokyo');
		if (!isToday) {
			eventDate = eventDate.add(1, 'day');
		}
		eventDate = eventDate.hour(hour).minute(minute).second(0).millisecond(0);

		const endTime = eventDate.add(1, 'hour');

		await calendar.events.insert({
			calendarId: TSG_EVENTS_CALENDAR_ID,
			requestBody: {
				summary: 'ITクイズ',
				description: '博多市が作成したITに関する早押しクイズ30問を、クイズアプリ上で一気に出題します！\n\n出題範囲は「インターネット」「プログラミング」「情報科学」「ソフトウェア」「ハードウェア」「IT企業」などITに少しでも関係ある様々な分野から、そして専門的な内容から一般的な知識まで幅広く出題されます。\n\n時間になると、クイズイベントへの参加リンクがDiscordやSlackの#sig-quizチャンネルなどに投稿されます。\n参加するためには「みんなで早押しクイズ」アプリのインストールが必要になるので、事前に準備しておいてください！',
				location: IT_QUIZ_DISCORD_EVENT_URL.value(),
				start: {
					dateTime: eventDate.toISOString(),
					timeZone: 'Asia/Tokyo',
				},
				end: {
					dateTime: endTime.toISOString(),
					timeZone: 'Asia/Tokyo',
				},
			},
		});

		logInfo(`ITクイズの予定を追加しました: ${eventDate.toISOString()}`);
	} catch (error) {
		logInfo(`ITクイズの予定追加に失敗しました: ${error}`);
		throw error;
	}
};

eventAdapter.on('message', async (message: Message) => {
	if (
		message.channel === SIG_QUIZ_CHANNEL_ID &&
		message.user === HAKATASHI_ID &&
		message.subtype !== 'bot_message' &&
		typeof message.bot_id !== 'string' &&
		!message.hidden &&
		message.text
	) {
		const quizInfo = parseITQuizAnnouncement(message.text);
		if (quizInfo) {
			try {
				await addITQuizToCalendar(quizInfo.hour, quizInfo.minute, quizInfo.isToday);

				await slack.reactions.add({
					channel: message.channel,
					timestamp: message.ts,
					name: 'calendar',
				});
			} catch {
				await slack.reactions.add({
					channel: message.channel,
					timestamp: message.ts,
					name: 'x',
				});
			}
		}
	}
});

// What's wrong?
eventAdapter.constructor.prototype.emit = async function (eventName: string, event: any, respond: () => void) {
	for (const listener of this.listeners(eventName) as ((ev: any) => Promise<any>)[]) {
		await listener.call(this, event);
	}
	respond();
};

const requestListener = eventAdapter.requestListener();

export const slackEvent = onRequest(
	{
		memory: '512MiB',
	},
	(request, response) => {
		if (request.headers['x-slack-retry-num']) {
			logInfo(`Ignoring Slack retry message: ${request.headers['x-slack-retry-num']}`);
			response.status(202).send('OK');
			return;
		}

		requestListener(request, response);
	},
);

export {slack as webClient};
