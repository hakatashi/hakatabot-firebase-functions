import type {ChartConfiguration} from 'chart.js';
import dayjs, {Dayjs} from 'dayjs';
import {info as logInfo} from 'firebase-functions/logger';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {google} from 'googleapis';
import {IT_QUIZ_GOOGLE_SHEET_ID, IT_QUIZ_ID} from '../const.js';
import {ItQuizProgressStats, State} from '../firestore.js';
import {getGoogleAuth} from '../google.js';
import {webClient as slack} from '../slack.js';

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const state = new State('it-quiz');

const getItQuizStats = async () => {
	const auth = await getGoogleAuth();
	const sheets = google.sheets({version: 'v4', auth});

	const [[doneStr], [ideasStr]] = await new Promise<string[][]>((resolve, reject) => {
		sheets.spreadsheets.values.get({
			spreadsheetId: IT_QUIZ_GOOGLE_SHEET_ID,
			range: 'stats!B:B',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else if (response?.data?.values) {
				resolve(response.data.values);
			} else {
				reject(new Error('values not found'));
			}
		});
	});

	const done = parseInt(doneStr);
	const ideas = parseInt(ideasStr);

	return {done, ideas};
};

const getItQuizStatsImageUrl = async (timestamp: Dayjs) => {
	logInfo('itQuizProgressCronJob: Getting stats of past 2 weeks...');

	const dates = Array(14).fill(0).map((_, index) => {
		const date = timestamp.subtract(13 - index, 'day').format('YYYY-MM-DD');
		return date;
	});

	const twoWeeksAgoDate = timestamp.subtract(2, 'week').format('YYYY-MM-DD');
	const results = await ItQuizProgressStats
		.where('date', '>=', twoWeeksAgoDate)
		.orderBy('date', 'asc')
		.get();

	const stats = results.docs.map((doc) => doc.data());
	logInfo(`itQuizProgressCronJob: stats = ${JSON.stringify(stats)}`);

	const imageChartsPayload: ChartConfiguration = {
		type: 'line',
		data: {
			labels: dates.map((date) => {
				const weekday = dayjs(date).day();
				return weekdayLabels[weekday];
			}),
			datasets: [
				{
					label: 'Ideas',
					backgroundColor: '#FF6384',
					borderColor: '#FF6384',
					data: dates.map((date) => {
						const stat = stats.find((s) => s.date === date);
						return stat?.ideas ?? null;
					}),
					fill: false,
				},
				{
					label: 'Done',
					backgroundColor: '#36A2EB',
					borderColor: '#36A2EB',
					data: dates.map((date) => {
						const stat = stats.find((s) => s.date === date);
						return stat?.done ?? null;
					}),
					fill: false,
				},
				{
					label: 'Target',
					borderWidth: 1,
					borderColor: '#FF9800',
					data: dates.map(() => 30),
					pointRadius: 0,
					fill: false,
				},
			],
		},
		options: {
			title: {
				display: true,
				text: 'IT quiz stocks',
			},
		},
	};

	const imageChartsUrl = `https://image-charts.com/chart.js/2.8.0?${new URLSearchParams({
		bkg: 'white',
		c: JSON.stringify(imageChartsPayload),
		width: '500',
		height: '300',
	})}`;
	logInfo(`itQuizProgressCronJob: imageChartsUrl = ${imageChartsUrl}`);

	return imageChartsUrl;
};

export const itQuizProgressCronJob = onSchedule(
	{
		schedule: '0 19 * * *',
		timeZone: 'Asia/Tokyo',
	},
	async (context) => {
		const timestamp = dayjs(context.scheduleTime).tz('Asia/Tokyo');
		const currentDate = timestamp.format('YYYY-MM-DD');
		logInfo(`itQuizProgressCronJob triggered at ${timestamp} (date = ${currentDate})`);

		const {done, ideas} = await getItQuizStats();
		logInfo(`itQuizProgressCronJob: done = ${done}, ideas = ${ideas}`);

		await ItQuizProgressStats.doc(currentDate).set({
			done,
			ideas,
			date: currentDate,
		}, {merge: true});

		const imageChartsUrl = await getItQuizStatsImageUrl(timestamp);

		const slackText = `【ITクイズの現在の進捗】\n完了: ＊${done}問＊ / アイデア: ＊${ideas}問＊`;
		const slackMessage = await slack.chat.postMessage({
			channel: IT_QUIZ_ID,
			username: 'ITクイズ進捗くん',
			icon_emoji: ':quora:',
			text: slackText,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: slackText,
					},
				},
				{
					type: 'image',
					image_url: imageChartsUrl,
					alt_text: 'IT quiz stocks',
				},
			],
		});

		logInfo(`itQuizProgressCronJob: slackMessage = ${JSON.stringify(slackMessage)}`);
	},
);

export const itQuizMilestoneProgressCronJob = onSchedule(
	{
		schedule: 'every 10 minutes',
		timeZone: 'Asia/Tokyo',
	},
	async (context) => {
		const timestamp = dayjs(context.scheduleTime).tz('Asia/Tokyo');
		const currentDate = timestamp.format('YYYY-MM-DD');
		logInfo(`itQuizMilestoneProgressCronJob triggered at ${timestamp} (date = ${currentDate})`);

		const previousProgress = await state.get('previousProgress', 0);
		const {done, ideas} = await getItQuizStats();

		logInfo(`itQuizMilestoneProgressCronJob: done = ${done}, ideas = ${ideas}, previousProgress = ${previousProgress}`);

		await state.set({previousProgress: done});

		let milestoneCompleted: null | number = null;
		if (done > previousProgress) {
			if (done >= 10 && previousProgress < 10) {
				milestoneCompleted = 10;
			}
			if (done >= 20 && previousProgress < 20) {
				milestoneCompleted = 20;
			}
			if (done >= 30 && previousProgress < 30) {
				milestoneCompleted = 30;
			}
		}

		if (milestoneCompleted === null) {
			return;
		}

		await ItQuizProgressStats.doc(currentDate).set({
			done,
			ideas,
			date: currentDate,
		}, {merge: true});

		const imageChartsUrl = await getItQuizStatsImageUrl(timestamp);

		const slackText = `【ITクイズの現在の進捗 (${milestoneCompleted}問突破🎉)】\n完了: ＊${done}問＊ / アイデア: ＊${ideas}問＊`;
		await slack.chat.postMessage({
			channel: IT_QUIZ_ID,
			username: 'ITクイズ進捗くん',
			icon_emoji: ':quora:',
			text: slackText,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: slackText,
					},
				},
				{
					type: 'image',
					image_url: imageChartsUrl,
					alt_text: 'IT quiz stocks',
				},
			],
		});
	},
);
