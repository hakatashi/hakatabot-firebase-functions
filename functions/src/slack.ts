import {createEventAdapter} from '@slack/events-api';
import {WebClient} from '@slack/web-api';
import type {WebAPICallResult, MessageAttachment, KnownBlock} from '@slack/web-api';
import download from 'download';
import {https, logger, config as getConfig} from 'firebase-functions';
import {HAKATASHI_ID, SATOS_ID, SANDBOX_ID} from './const';
import twitter from './twitter';

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
	username: string,
	attachments?: Attachment[],
	files?: File[],
	reactions?: Reaction[],
	blocks?: KnownBlock[],
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

// What's wrong?
eventAdapter.constructor.prototype.emit = async function (eventName: string, event: any, respond: Function) {
	for (const listener of this.listeners(eventName) as Function[]) {
		await listener.call(this, event);
	}
	respond();
};

export const slackEvent = https.onRequest(eventAdapter.requestListener());
export {slack as webClient};
