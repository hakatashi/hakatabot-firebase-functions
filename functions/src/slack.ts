import {PubSub} from '@google-cloud/pubsub';
import {createEventAdapter} from '@slack/events-api';
import {WebClient} from '@slack/web-api';
import type {WebAPICallResult, MessageAttachment, KnownBlock} from '@slack/web-api';
import download from 'download';
import {https, logger, config as getConfig} from 'firebase-functions';
import {sample} from 'lodash';
import {HAKATASHI_ID, SATOS_ID, SANDBOX_ID, TSG_SLACKBOT_ID, RANDOM_ID, TSGBOT_ID} from './const';
import {db, States} from './firestore';
import twitter from './twitter';

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

const getTwitterAccount = (reaction: string) => {
	if (reaction === 'red_large_square_satos') {
		return 'satos_sandbox';
	}
	if (reaction === 'white_large_square' || reaction === 'red_large_square') {
		return 'hakatashi';
	}
	if (reaction === 'a') {
		return 'hakatashi_A';
	}
	if (reaction === 'b') {
		return 'hakatashi_B';
	}
	if (reaction === 'o2') {
		return 'hakatashi_O';
	}
	if (reaction === 'ab') {
		return 'hakatashi_AB';
	}
	return null;
};

const unescapeSlackComponent = (text: string) => (
	text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
);

// Slack-Twitter tunnel
eventAdapter.on('reaction_added', async (event: ReactionAddedEvent) => {
	if (event.item.type === 'message') {
		const account = getTwitterAccount(event.reaction);

		if (account === null) {
			return;
		}

		if (account !== 'satos_sandbox' && !(event.user === HAKATASHI_ID && event.item_user === HAKATASHI_ID)) {
			return;
		}

		if (account === 'satos_sandbox' && !(event.item_user === SATOS_ID && event.item.channel === SANDBOX_ID)) {
			return;
		}

		const {messages} = await slack.conversations.replies({
			channel: event.item.channel,
			ts: event.item.ts,
			latest: event.item.ts,
			inclusive: true,
			limit: 1,
		}) as GetMessagesResult;

		if (!messages || messages.length !== 1) {
			return;
		}

		const message = messages[0]!;

		if (account === 'satos_sandbox' && message.reactions) {
			const reaction = message.reactions.find(({name}) => event.reaction === name);
			if (reaction && reaction.count >= 2) {
				return;
			}
		}

		const urls = [];

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

		const mediaIds = [];
		for (const url of urls.slice(0, 4)) {
			const {hostname} = new URL(url);
			const imageData = await download(url, undefined, {
				headers: {
					...(hostname === 'files.slack.com' ? {Authorization: `Bearer ${config.slack.token}`} : {}),
				},
			});
			const data = await twitter(account, 'POST', 'media/upload', {
				media_data: imageData.toString('base64'),
				media_category: 'tweet_image',
			});
			mediaIds.push(data.media_id_string);
		}

		// Unescape
		let text = message.text.replace(/<(?<component>.+?)>/g, (match, component) => {
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

		if (account === 'satos_sandbox') {
			text = `[${event.user}] ${text}`;
		}

		try {
			const data = await twitter(account, 'POST', 'statuses/update', {
				status: text,
				...(mediaIds.length > 0 ? {media_ids: mediaIds.join(',')} : {}),
			});
			logger.info(`Tweeted ${JSON.stringify(text)} with tweet ID ${data.id_str}`);
		} catch (error) {
			logger.error('Tweet errored', error);
		}
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
		const text = sample([
			'チンイツクイズ',
			'チンイツクイズhard',
			'ポッキーゲーム',
			'将棋',
			'15手必勝将棋',
			'たほいや',
			'素数大富豪',
			'今何時？',
			'あほくさスライドパズル',
			'寿司スライドパズル',
			'寿司スライドパズル 6',
			'千矢スライドパズル',
			'ベイビーロボット 1000手',
			'スーパーロボット 1000手',
			'ハイパーロボット 1000手',
			'ベイビーロボットバトル',
			'スーパーロボットバトル',
			'ハイパーロボットバトル',
			'wordhero',
			'hardhero',
			'crossword',
			'grossword',
			'ボイパーロボット',
			'ボイパーロボット100',
			'ボイパーロボットバトル',
			'ボイパーロボットバトル100',
			'デニム',
			'おみくじ',
			'ぽんぺ出題',
			'アニメ当てクイズ',
			'アニメ当てクイズeasy',
			'アニメ当てクイズhard',
			'アニメ当てクイズextreme',
			'アニソン当てクイズ',
			'アニソン当てクイズeasy',
			'アニソン当てクイズhard',
			'キャラ当てクイズ',
			'ソートなぞなぞ',
			'ソートなぞなぞ 20字',
			'@cfb',
			'物件ガチャ',
			'物件ガチャ 東京都',
			'早押しクイズ',
			'早押しクイズhard',
			'hitandblow',
			'hitandblow 10',
			'octas',
			'hangman',
			'hangman easy',
			'hangman hard',
			'hangman extreme',
			'きらファン当てクイズ',
			'文豪クイズ',
			'文豪当てクイズ',
			'ダーツの旅',
			'ダーツの旅 東京都',
			'実績当てクイズ',
			'和同開珎',
			'座標当て',
			'座標当て 0.1',
		]);

		await slack.chat.postMessage({
			as_user: true,
			channel: SANDBOX_ID,
			text,
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

// Rinna signal
eventAdapter.on('message', async (message: Message) => {
	if (
		message.channel !== SANDBOX_ID ||
		typeof message.thread_ts === 'string' ||
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
					ts: message.ts,
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
					ts: message.ts,
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
				message.username === '今言うな'
			)
		) {
			recentHumanMessages.push(message);
		} else if (
			message.subtype === 'bot_message' ||
			typeof message.bot_id === 'string' ||
			message.user === 'USLACKBOT' ||
			message.user === TSGBOT_ID ||
			isRinnaSignalBlockList(message.text || '')
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
				(
					(message.text || '').includes('りんな') ||
					(message.text || '').includes('うな')
				)
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

// What's wrong?
eventAdapter.constructor.prototype.emit = async function (eventName: string, event: any, respond: () => void) {
	for (const listener of this.listeners(eventName) as ((ev: any) => Promise<any>)[]) {
		await listener.call(this, event);
	}
	respond();
};

export const slackEvent = https.onRequest(eventAdapter.requestListener());
export {slack as webClient};
