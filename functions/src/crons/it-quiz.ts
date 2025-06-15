import qs from 'node:querystring';
import type {ChartConfiguration} from 'chart.js';
import dayjs, {Dayjs} from 'dayjs';
import {info as logInfo} from 'firebase-functions/logger';
import {defineString} from 'firebase-functions/params';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {google} from 'googleapis';
import range from 'lodash/range.js';
import sortBy from 'lodash/sortBy.js';
import tinycolor from 'tinycolor2';
import {IT_QUIZ_GOOGLE_SHEET_ID, IT_QUIZ_ID, IT_QUIZ_YOUTUBE_CHANNEL_ID} from '../const.js';
import {ItQuizProgressStats, ItQuizVideoEngagements, ItQuizVideoEngagementStats, State} from '../firestore.js';
import {getGoogleAuth} from '../google.js';
import {webClient as slack} from '../slack.js';
import {getLatestInstagramVideoEngagements} from './lib/instagram.js';
import {getLatestTikTokVideoEngagements} from './lib/tiktok.js';
import {getLatestYouTubeVideoEngagements} from './lib/youtube.js';

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const state = new State('it-quiz');

const INSTAGRAM_ACCESS_TOKEN = defineString('INSTAGRAM_ACCESS_TOKEN');

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

const onlyEncodeSpecialChars = (str: string) => (
	str.replace(/[%&=+# "]/g, (match) => encodeURIComponent(match))
);

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

	const imageChartsUrl = `https://image-charts.com/chart.js/2.8.0?${qs.stringify({
		bkg: 'white',
		c: JSON.stringify(imageChartsPayload),
		width: '500',
		height: '300',
	}, undefined, undefined, {
		encodeURIComponent: onlyEncodeSpecialChars,
	})}`;
	logInfo(`itQuizProgressCronJob: imageChartsUrl = ${imageChartsUrl}`);

	return imageChartsUrl;
};

const getVideoEngagementsHistory = (
	engagements: ItQuizVideoEngagementStats[],
	volume: string,
	platform: 'tiktok' | 'youtube' | 'instagram',
) => {
	const firstNonZeroIndex = engagements.findIndex((eng) => {
		const platformEngagements = eng[platform];
		if (!platformEngagements) {
			return false;
		}
		const videoEngagements = platformEngagements.find((vid) => vid.volume === volume);
		if (!videoEngagements) {
			return false;
		}
		return videoEngagements.engagements.impressions > 0;
	});

	if (firstNonZeroIndex === -1) {
		return Array(7).fill(0);
	}

	const engagementsToConsider = engagements.slice(firstNonZeroIndex, firstNonZeroIndex + 7);

	let previousImpressions = 0;
	const results: number[] = [];

	for (const engagement of engagementsToConsider) {
		if (!engagement[platform]) {
			results.push(0);
			continue;
		}

		const platformEngagements = engagement[platform];
		const video = platformEngagements.find((vid) => vid.volume === volume);
		if (!video) {
			results.push(0);
			continue;
		}

		const impressions = video.engagements.impressions;
		if (impressions > previousImpressions) {
			results.push(impressions - previousImpressions);
			previousImpressions = impressions;
		} else {
			results.push(0);
		}
	}

	return results;
};

const getItQuizVideoEngagementsImageUrl = async (timestamp: Dayjs) => {
	logInfo('itQuizVideoEngagementsImageUrl: Getting stats of past 14 days...');
	const results = await ItQuizVideoEngagements
		.where('date', '>=', timestamp.subtract(13, 'day').format('YYYY-MM-DD'))
		.orderBy('date', 'asc')
		.get();

	const engagements = results.docs.map((doc) => doc.data());
	logInfo(`itQuizVideoEngagementsImageUrl: engagements = ${JSON.stringify(engagements)}`);

	const videoVolumes = new Set<string>();
	for (const engagement of engagements) {
		for (const platform of ['tiktok', 'youtube', 'instagram'] as const) {
			if (engagement[platform]) {
				for (const video of engagement[platform]) {
					videoVolumes.add(video.volume);
				}
			}
		}
	}

	const latestVideoVolumes = Array.from(videoVolumes).sort((a, b) => (
		Number.parseInt(a) - Number.parseInt(b)
	)).slice(-7);

	const videoEngagementStats: {volume: string, tiktok: number[], youtube: number[], instagram: number[]}[] = [];
	for (const volume of latestVideoVolumes) {
		const tiktokEngagements = getVideoEngagementsHistory(engagements, volume, 'tiktok');
		const youtubeEngagements = getVideoEngagementsHistory(engagements, volume, 'youtube');
		const instagramEngagements = getVideoEngagementsHistory(engagements, volume, 'instagram');
		videoEngagementStats.push({
			volume,
			tiktok: tiktokEngagements,
			youtube: youtubeEngagements,
			instagram: instagramEngagements,
		});
	}

	const imageChartsPayload: ChartConfiguration = {
		type: 'bar',
		data: {
			labels: videoEngagementStats.map((stat) => `#${stat.volume}`),
			datasets: sortBy(range(5).flatMap((index) => [
				{
					label: `TikTok (Day ${index + 1})`,
					backgroundColor: tinycolor('#AAAAAA').darken(index / 6 * 50).toRgbString(),
					data: videoEngagementStats.map((stat) => stat.tiktok[index] ?? 0),
					fill: true,
				},
				{
					label: `YouTube (Day ${index + 1})`,
					backgroundColor: tinycolor('#FF6384').darken(index / 6 * 50).toRgbString(),
					data: videoEngagementStats.map((stat) => stat.youtube[index] ?? 0),
					fill: true,
				},
				{
					label: `Instagram (Day ${index + 1})`,
					backgroundColor: tinycolor('#FF9800').darken(index / 6 * 50).toRgbString(),
					data: videoEngagementStats.map((stat) => stat.instagram[index] ?? 0),
					fill: true,
				},
			]), 'label'),
		},
		options: {
			title: {
				display: true,
				text: 'IT quiz video impressions',
			},
			scales: {
				xAxes: [{
					stacked: true,
				}],
				yAxes: [{
					stacked: true,
					ticks: {
						beginAtZero: true,
					},
				}],
			},
			legend: {
				display: true,
			},
		},
	};

	const imageChartsUrl = `https://image-charts.com/chart.js/2.8.0?${qs.stringify({
		bkg: 'white',
		c: JSON.stringify(imageChartsPayload),
		width: '1600',
		height: '800',
	}, undefined, undefined, {
		encodeURIComponent: onlyEncodeSpecialChars,
	})}`;

	logInfo(`itQuizVideoEngagementsImageUrl: imageChartsUrl = ${imageChartsUrl}`);
	return imageChartsUrl;
};

export const itQuizProgressCronJob = onSchedule(
	{
		schedule: '0 19 * * *',
		timeZone: 'Asia/Tokyo',
		memory: '512MiB',
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

		const tikTokEngagement = await getLatestTikTokVideoEngagements();
		logInfo(`itQuizMilestoneProgressCronJob: tikTokEngagement = ${JSON.stringify(tikTokEngagement)}, total days = ${tikTokEngagement.length}`);

		const youtubeEngagement = await getLatestYouTubeVideoEngagements(IT_QUIZ_YOUTUBE_CHANNEL_ID);
		logInfo(`itQuizMilestoneProgressCronJob: youtubeEngagement = ${JSON.stringify(youtubeEngagement)}, total days = ${youtubeEngagement.length}`);

		const instagramEngagement = await getLatestInstagramVideoEngagements(INSTAGRAM_ACCESS_TOKEN.value());
		logInfo(`itQuizMilestoneProgressCronJob: instagramEngagement = ${JSON.stringify(instagramEngagement)}, total days = ${instagramEngagement.length}`);

		await ItQuizVideoEngagements.doc(currentDate).set({
			tiktok: tikTokEngagement,
			youtube: youtubeEngagement,
			instagram: instagramEngagement,
			date: currentDate,
		}, {merge: true});

		{
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
		}

		{
			const imageChartsUrl = await getItQuizVideoEngagementsImageUrl(timestamp);
			logInfo(`itQuizProgressCronJob: imageChartsUrl = ${imageChartsUrl}`);

			const lastYouTubeVideoImpressions = youtubeEngagement[youtubeEngagement.length - 1]?.engagements.impressions || 0;
			const lastTikTokVideoImpressions = tikTokEngagement[tikTokEngagement.length - 1]?.engagements.impressions || 0;
			const lastInstagramVideoImpressions = instagramEngagement[instagramEngagement.length - 1]?.engagements.impressions || 0;

			const slackText = [
				'【前回のITクイズ動画の視聴回数】',
				`YouTube: ＊${lastYouTubeVideoImpressions}回＊`,
				`TikTok: ＊${lastTikTokVideoImpressions}回＊`,
				`Instagram: ＊${lastInstagramVideoImpressions}回＊`,
			].join('\n');

			const slackMessage = await slack.chat.postMessage({
				channel: IT_QUIZ_ID,
				username: 'ITクイズ視聴回数くん',
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
						alt_text: 'IT quiz video impressions',
					},
				],
			});

			logInfo(`itQuizProgressCronJob: slackMessage = ${JSON.stringify(slackMessage)}`);
		}
	},
);

export const itQuizMilestoneProgressCronJob = onSchedule(
	{
		schedule: 'every 10 minutes',
		timeZone: 'Asia/Tokyo',
		memory: '512MiB',
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
