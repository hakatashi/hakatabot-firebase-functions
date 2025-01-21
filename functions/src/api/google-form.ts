import {PubSub} from '@google-cloud/pubsub';
import {https, logger, config as getConfig} from 'firebase-functions';

const config = getConfig();

export const googleFormLlmBenchmarkSubmission = https.onRequest(async (request, response) => {
	logger.info('googleFormLlmBenchmarkSubmission started');
	logger.info(`method: ${request.method}`);

	if (request.method !== 'POST') {
		response.status(405);
		response.send('Method Not Allowed');
		return;
	}

	const data = request.body;

	if (data.token !== config.api.token) {
		logger.error('Invalid token');
		response.status(403);
		response.send('Forbidden');
		return;
	}

	const pubsubClient = new PubSub();

	await pubsubClient.topic('hakatabot').publishMessage({
		data: Buffer.from(JSON.stringify({
			type: 'llm-benchmark-submission',
			data,
		})),
	});

	logger.info('Published LLM benchmark submission message to topic hakatabot');

	response.status(200).send('OK');
});
