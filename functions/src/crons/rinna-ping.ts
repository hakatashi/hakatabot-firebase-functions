import {PubSub, Message} from '@google-cloud/pubsub';
import axios from 'axios';
import {config as getConfig} from 'firebase-functions';
import {info as logInfo, error as logError} from 'firebase-functions/logger';
import {onSchedule} from 'firebase-functions/v2/scheduler';

const config = getConfig();

const pubsubClient = new PubSub();

interface PongMessage {
	type: 'rinna-pong',
	mode: string,
}

export const rinnaPingCronJob = onSchedule('every 5 minutes', async () => {
	const now = Date.now();

	const topicId = `rinna-ping-${now}`;
	const subscriptionId = `rinna-ping-subscription-${now}`;

	logInfo(`Creating one-time subscription (topicId = ${topicId}, subscriptionId = ${subscriptionId})`);

	const [topic] = await pubsubClient.createTopic(topicId);

	logInfo(`Created topic ${topicId}`);

	const [subscription] = await pubsubClient
		.topic(topicId)
		.createSubscription(subscriptionId, {
			enableExactlyOnceDelivery: true,
		});

	logInfo(`Created subscription ${subscriptionId}`);

	// eslint-disable-next-line no-undef
	let timeoutId: NodeJS.Timeout | null = null;

	try {
		const pongPromise = new Promise<PongMessage>((resolve) => {
			subscription.once('message', (message: Message) => {
				logInfo(`Received message ${message.id}`);
				logInfo(message);

				message.ack();

				const data = JSON.parse(message.data.toString());
				resolve(data);
			});
		});

		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeoutId = setTimeout(() => {
				logError('Timed out');
				reject(new Error('Timeout'));
			}, 1000 * 30);
		});

		logInfo('Publishing ping message to topic hakatabot');

		pubsubClient
			.topic('hakatabot')
			.publishMessage({
				data: Buffer.from(JSON.stringify({
					type: 'rinna-ping',
					topicId,
				})),
			});

		logInfo('Published ping message to topic hakatabot');

		const pongMessage = await Promise.race([pongPromise, timeoutPromise]);
		const status = pongMessage.mode === 'GPU' ? 'operational' : 'degraded_performance';

		logInfo(`Posting status (mode = ${pongMessage.mode}, status = ${status})`);
		await axios.patch(
			`https://api.statuspage.io/v1/pages/${config.statuspage.page_id}/components/${config.statuspage.component_id}`,
			{
				component: {status},
			},
			{
				headers: {
					Authorization: `OAuth ${config.statuspage.token}`,
				},
			},
		);
	} catch (error) {
		logError(error);

		logInfo('Posting status (status = major_outage)');
		await axios.patch(
			`https://api.statuspage.io/v1/pages/${config.statuspage.page_id}/components/${config.statuspage.component_id}`,
			{
				component: {
					status: 'major_outage',
				},
			},
			{
				headers: {
					Authorization: `OAuth ${config.statuspage.token}`,
				},
			},
		);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		subscription.removeAllListeners('message');

		logInfo(`Deleting subscription ${subscriptionId}`);
		await subscription.delete();
		logInfo(`Deleted subscription ${subscriptionId}`);

		logInfo(`Deleting topic ${topicId}`);
		await topic.delete();
		logInfo(`Deleted topic ${topicId}`);
	}
});
