import {PubSub} from '@google-cloud/pubsub';
import {createEventAdapter} from '@slack/events-api';
import {WebClient} from '@slack/web-api';
import type {WebAPICallResult, MessageAttachment, KnownBlock} from '@slack/web-api';
import {stripIndents} from 'common-tags';
import {https, logger, config as getConfig} from 'firebase-functions';
import range from 'lodash/range.js';
import shuffle from 'lodash/shuffle.js';
import {HAKATASHI_ID, SANDBOX_ID, TSG_SLACKBOT_ID, RANDOM_ID, TSGBOT_ID} from './const.js';
import {db, State, States} from './firestore.js';

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

const config = getConfig();

const slack = new WebClient(config.slack.token);
const eventAdapter = createEventAdapter(config.slack.signing_secret, {waitForResponse: true});

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

eventAdapter.on('reaction_added', async (event: ReactionAddedEvent) => {
	if (event.item.type === 'message') {
		await letterpackBomb(event);
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
			if (message.text === '@りんな optout') {
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

			if (message.text === '@りんな optin') {
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
			isRinnaSignalBlockList(message.text ?? '')
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
				matchRinnaSignalText(message.text ?? '')
			) ||
			(
				newHumanMessages.length >= 5 &&
				newBotMessages.length <= newHumanMessages.length / 2 &&
				new Set(newHumanMessages.map(({user}) => user)).size >= 3 &&
				ts >= lastSignal + 60 * 60 &&
				Math.random() < 0.3
			)
		) {
			logger.log(`rinna-signal: Signal triggered on ${ts} (lastSignal = ${lastSignal})`);

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
	const output = doc.get('output') as string ?? '';
	const character = doc.get('character') as string ?? '';
	const moderations = resultDocs.map((resultDoc) => resultDoc.get('moderations') as Moderations ?? {});

	const tailText = output.split('」').slice(1).join('」');
	let text = stripIndents`
		Input:
		\`\`\`
		${inputDialog.trim()}
		\`\`\`
		Result:
		\`\`\`
		${character}「${outputSpeech.trim()}」
		\`\`\`
		Continuation Text:
		\`\`\`
		${tailText.trim()}
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
	// eslint-disable-next-line prefer-destructuring
	const operation = tokens[1];
	const user = tokens.slice(2).join(' ');

	const state = new State('sleep-battle-cron-job');
	let optoutUsers = await state.get('optoutUsers', [] as string[]);
	const slackUsers = await state.get('slackUsers', Object.create(null) as {[slackId: string]: string});
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

// What's wrong?
eventAdapter.constructor.prototype.emit = async function (eventName: string, event: any, respond: () => void) {
	for (const listener of this.listeners(eventName) as ((ev: any) => Promise<any>)[]) {
		await listener.call(this, event);
	}
	respond();
};

const requestListener = eventAdapter.requestListener();

export const slackEvent = https.onRequest((request, response) => {
	if (request.headers['x-slack-retry-num']) {
		logger.log(`Ignoring Slack retry message: ${request.headers['x-slack-retry-num']}`);
		response.status(202).send('OK');
		return;
	}

	requestListener(request, response);
});

export {slack as webClient};
