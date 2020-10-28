import qs from 'querystring';
import {createEventAdapter} from '@slack/events-api';
import {WebClient} from '@slack/web-api';
import {https, logger, config as getConfig} from 'firebase-functions';
import {OAuth} from 'oauth';
import {HAKATASHI_ID} from './const';

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

interface Message {
	type: string,
	subtype: string,
	text: string,
	ts: string,
	username: string,
}

const config = getConfig();

const slack = new WebClient(config.slack.token);
const eventAdapter = createEventAdapter(config.slack.signing_secret);

const twitter = (account: string, method: 'GET' | 'POST', endpoint: string, parameters: {[key: string]: string}) => {
	const keys = config.twitter.tokens[account.toLowerCase()];
	if (typeof keys !== 'object') {
		throw new Error(`token not found: ${account}`);
	}

	const oauth = new OAuth(
		'https://api.twitter.com/oauth/request_token',
		'https://api.twitter.com/oauth/access_token',
		keys.consumer_key,
		keys.consumer_secret,
		'1.0A',
		null,
		'HMAC-SHA1',
	);

	const domain = `${endpoint.startsWith('media/') ? 'upload' : 'api'}.twitter.com`;

	return new Promise<any>((resolve, reject) => {
		if (method === 'GET') {
			oauth.get(
				`https://${domain}/1.1/${endpoint}.json?${qs.stringify(parameters)}`,
				keys.access_token,
				keys.access_token_secret,
				(error, d) => {
					if (error) {
						reject(error);
					} else if (d) {
						resolve(JSON.parse(d.toString()));
					} else {
						reject(new Error('No data'));
					}
				},
			);
		} else {
			oauth.post(
				`https://${domain}.twitter.com/1.1/${endpoint}.json`,
				keys.access_token,
				keys.access_token_secret,
				parameters,
				'application/x-www-form-urlencoded',
				(error, d) => {
					if (error) {
						reject(error);
					} else if (d) {
						resolve(JSON.parse(d.toString()));
					} else {
						reject(new Error('No data'));
					}
				},
			);
		}
	});
};

const getTwitterAccount = (reaction: string) => {
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

eventAdapter.on('reaction_added', async (event: ReactionAddedEvent) => {
	if (event.user === HAKATASHI_ID && event.item_user === HAKATASHI_ID && event.item.type === 'message') {
		const account = getTwitterAccount(event.reaction);

		if (account === null) {
			return;
		}

		const {messages}: {messages: Message[]} = await slack.conversations.replies({
			channel: event.item.channel,
			ts: event.item.ts,
			latest: event.item.ts,
			inclusive: true,
			limit: 1,
		}) as any;

		if (!messages || messages.length !== 1) {
			return;
		}

		const message = messages[0]!;
		const data = await twitter(account, 'POST', 'statuses/update', {status: message.text});

		logger.info(`Tweeted ${JSON.stringify(message.text)} with tweet ID ${data.id_str}`);
	}
});

export const slackEvent = https.onRequest(eventAdapter.requestListener());
