import {isAxiosError} from 'axios';
import {info as logInfo, warn as logWarn} from 'firebase-functions/logger';
import {post as tikTokPost} from '../../tiktok.js';

export interface TikTokEngagement {
	impressions: number;
	likes: number;
	comments: number;
}

export interface TikTokVideo {
	id: string;
	title: string;
	video_description: string;
	create_time: number;
	cover_image_url: string;
	share_url: string;
	view_count: number;
	like_count: number;
	comment_count: number;
	share_count: number;
}

interface TikTokApiResponse {
	data: {
		videos: TikTokVideo[];
		cursor: number;
		has_more: boolean;
	};
}

export const getLatestTikTokVideoEngagements = async (): Promise<{volume: string, engagements: TikTokEngagement}[]> => {
	try {
		// Get user's videos using TikTok API for Developers
		// Using the Content Publishing API to get user's videos
		const responseData: TikTokApiResponse = await tikTokPost('/v2/video/list/', {
			max_count: 20, // Get up to 20 recent videos
		}, {
			fields: 'id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count',
		});

		if (!responseData.data.videos || responseData.data.videos.length === 0) {
			throw new Error('No videos found for the TikTok account');
		}

		const videos = responseData.data.videos;
		logInfo(`[getLatestTikTokVideoEngagements] Found ${videos.length} videos`);

		// Group videos by volume number and aggregate engagement
		const engagementByVolume = new Map<string, TikTokEngagement>();

		for (const video of videos) {
			// Extract volume number from title or description (format: "#number")
			const text = `${video.title || ''} ${video.video_description || ''}`;
			const volumeMatch = text.match(/#(?<volume>\d+)/);
			if (!volumeMatch || !volumeMatch.groups) {
				continue; // Skip videos without volume numbers
			}
			const volume = volumeMatch.groups.volume;

			logInfo(`[getLatestTikTokVideoEngagements] Processing video ID: ${video.id}, Volume: #${volume}`);

			// TikTok uses view_count as impressions equivalent
			const impressions = video.view_count || 0;
			const likes = video.like_count || 0;
			const comments = video.comment_count || 0;

			// Aggregate engagement by volume
			const existing = engagementByVolume.get(volume) || {impressions: 0, likes: 0, comments: 0};
			engagementByVolume.set(volume, {
				impressions: existing.impressions + impressions,
				likes: existing.likes + likes,
				comments: existing.comments + comments,
			});
		}
		// Convert to array and sort by volume number (newest first - highest number first)
		return Array.from(engagementByVolume.entries())
			.sort(([a], [b]) => Number.parseInt(b) - Number.parseInt(a))
			.map(([volume, engagements]) => ({volume, engagements}));
	} catch (error) {
		if (isAxiosError(error)) {
			logWarn(error.response?.data || error.message);
		}
		if (error instanceof Error) {
			logWarn('[getLatestTikTokVideoEngagements] TikTok API error:', error.message);
			throw new Error(`Failed to fetch TikTok video engagements: ${error.message}`);
		}
		throw new Error('Failed to fetch TikTok video engagements: Unknown error');
	}
};
