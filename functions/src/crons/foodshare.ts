import {IncomingWebhook} from '@slack/webhook';
import axios from 'axios';
import download from 'download';
import {logger, pubsub, config as getConfig} from 'firebase-functions';
import cloudinary from '../cloudinary';
import {HAKATASHI_EMAIL} from '../const';
import {GoogleTokens, GoogleFoodPhotos, State} from '../firestore';
import {oauth2Client} from '../google';
import {webClient as slack} from '../slack';
import type {GetMessagesResult} from '../slack';
import twitter from '../twitter';

const config = getConfig();

const cookingWebhook = new IncomingWebhook(config.slack.webhooks.cooking);

export const foodshareSlackCronJob = pubsub.schedule('every 5 minutes').onRun(async () => {
	const hakatashiTokensData = await GoogleTokens.doc(HAKATASHI_EMAIL).get();

	if (!hakatashiTokensData.exists) {
		logger.error('hakatashi token not found');
		return;
	}

	const hakatashiTokens = hakatashiTokensData.data();
	oauth2Client.setCredentials(hakatashiTokens!);

	const accessToken = await oauth2Client.getAccessToken();

	const res = await axios.post('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
		filters: {
			contentFilter: {
				includedContentCategories: ['FOOD'],
			},
		},
	}, {
		headers: {
			Authorization: `Bearer ${accessToken.token}`,
			'Content-Type': 'application/json',
		},
	});

	for (const item of res.data.mediaItems.slice().reverse()) {
		const photoEntry = GoogleFoodPhotos.doc(item.id);
		if ((await photoEntry.get()).exists) {
			continue;
		}

		photoEntry.set(item);

		const originalUrl = `${item.baseUrl}=d`;
		const result = await cloudinary.uploader.upload(originalUrl);
		const url = cloudinary.url(`${result.public_id}.jpg`, {
			width: 1280,
			height: 1280,
			crop: 'fit',
		});
		await cookingWebhook.send({
			text: `料理した <${url}|写真>`,
			unfurl_links: false,
			unfurl_media: false,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'plain_text',
						text: '料理した',
						emoji: true,
					},
				},
				{
					type: 'image',
					block_id: 'image',
					image_url: url,
					alt_text: '料理',
				},
			],
		});
	}
});

export const foodshareTwitterCronJob = pubsub.schedule('every 5 minutes').onRun(async (context) => {
	const state = new State('foodshare-twitter-cron-job');

	const now = new Date(context.timestamp).getTime();

	const lastRun = await state.get('lastRun', now - 5 * 60 * 1000);

	const rangeEnd = now - 3 * 24 * 60 * 60 * 1000;
	const rangeStart = lastRun - 3 * 24 * 60 * 60 * 1000;

	await state.set({lastRun: now});

	const {messages} = await slack.conversations.history({
		channel: config.slack.channels.cooking,
		inclusive: true,
		latest: (rangeEnd / 1000).toString(),
		oldest: (rangeStart / 1000).toString(),
		limit: 100,
	}) as GetMessagesResult;

	for (const message of messages) {
		if (message.subtype === 'bot_message' && message.username === '博多市料理bot') {
			const block = message.blocks?.find(({type}) => type === 'image');
			if (block?.type === 'image') {
				if (message.reactions?.some(({name, users}) => (
					name === 'thinking_face' && users.includes(config.slack.users.hakatashi)
				))) {
					continue;
				}

				const url = block.image_url;
				const imageData = await download(url);
				const uploadResult = await twitter('hakatashi_B', 'POST', 'media/upload', {
					media_data: imageData.toString('base64'),
					media_category: 'tweet_image',
				});
				const mediaId = uploadResult.media_id_string;

				const postResult = await twitter('hakatashi_B', 'POST', 'statuses/update', {
					status: '料理した',
					media_ids: mediaId,
				});
				logger.info(`Tweeted cooking image with tweet ID ${postResult.id_str}`);
			}
			return;
		}
	}
});
