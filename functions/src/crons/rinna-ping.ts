import {PubSub, Message} from '@google-cloud/pubsub';
import {logger, pubsub} from 'firebase-functions';

const pubsubClient = new PubSub();

export const rinnaPingCronJob = pubsub.schedule('every 1 minute').onRun(async () => {
	const subscriptionId = `rinna-ping-${Date.now()}`;

	logger.info(`Creating one-time subscription (subscriptionId = ${subscriptionId})`);

	await pubsubClient
		.topic('hakatabot')
		.createSubscription(subscriptionId, {
			enableExactlyOnceDelivery: true,
		});

	logger.info(`Created subscription ${subscriptionId}`);

	const subscription = pubsubClient.subscription(subscriptionId);

	try {
		await new Promise<void>((resolve, reject) => {
			subscription.once('message', (message: Message) => {
				logger.info(`Received message ${message.id}`);
				logger.info(message);
				message.ackWithResponse().then(
					() => resolve(),
					(error) => reject(error),
				);
			});

			logger.info('Publishing ping message to topic hakatabot');

			pubsubClient
				.topic('hakatabot')
				.publishMessage({
					data: Buffer.from(JSON.stringify({
						type: 'rinna-ping',
						subscriptionId,
					})),
				});

			logger.info('Published ping message to topic hakatabot');
		});
	} catch (error) {
		logger.error(error);
	} finally {
		logger.info(`Deleting subscription ${subscriptionId}`);
		await subscription.delete();
		logger.info(`Deleted subscription ${subscriptionId}`);
	}
});
