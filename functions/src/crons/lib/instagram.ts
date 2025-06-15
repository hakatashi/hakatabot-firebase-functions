import axios from 'axios';
import {info as logInfo, warn as logWarn} from 'firebase-functions/logger';

export interface InstagramEngagement {
	impressions: number;
	likes: number;
	comments: number;
}

export interface InstagramMedia {
	id: string;
	caption: string;
	media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
	media_url: string;
	permalink: string;
	timestamp: string;
	like_count?: number;
	comments_count?: number;
}

interface InstagramInsightMetric {
	name: string;
	values: {value: number}[];
}

export const getLatestInstagramVideoEngagements = async (accessToken: string): Promise<[string, InstagramEngagement][]> => {
	try {
		// Get user's media using Instagram Basic Display API
		const mediaResponse = await axios.get('https://graph.instagram.com/me/media', {
			params: {
				fields: 'id,caption,media_type,media_url,permalink,timestamp',
				access_token: accessToken,
				limit: 50, // Get up to 50 recent posts
			},
		});

		if (!mediaResponse.data.data || mediaResponse.data.data.length === 0) {
			throw new Error('No media found for the Instagram account');
		}

		// Filter for VIDEO type media (reels/videos)
		const videoMedia: InstagramMedia[] = mediaResponse.data.data.filter((media: InstagramMedia) => media.media_type === 'VIDEO');

		if (videoMedia.length === 0) {
			throw new Error('No video content found in recent posts');
		}

		// Get detailed insights for each video
		const engagementByDay = new Map<string, InstagramEngagement>();

		for (const video of videoMedia) {
			try {
				logInfo(`[getLatestInstagramVideoEngagements] Fetching insights for video ID: ${video.id}`);

				// Get insights for the video
				const insightsResponse = await axios.get(`https://graph.instagram.com/${video.id}/insights`, {
					params: {
						metric: 'views,comments,likes',
						access_token: accessToken,
					},
				});

				// Extract date in YYYY-MM-DD format
				const date = new Date(video.timestamp).toISOString().split('T')[0];

				// Parse engagement metrics
				const insights = insightsResponse.data.data;
				const impressions = insights.find((metric: InstagramInsightMetric) => metric.name === 'views')?.values[0]?.value || 0;
				const likes = insights.find((metric: InstagramInsightMetric) => metric.name === 'likes')?.values[0]?.value || 0;
				const comments = insights.find((metric: InstagramInsightMetric) => metric.name === 'comments')?.values[0]?.value || 0;

				// Aggregate engagement by day
				const existing = engagementByDay.get(date) || {impressions: 0, likes: 0, comments: 0};
				engagementByDay.set(date, {
					impressions: existing.impressions + impressions,
					likes: existing.likes + likes,
					comments: existing.comments + comments,
				});
			} catch (insightError: any) {
				// Instagram Basic Display API might not have access to insights
				// Fall back to public metrics if available
				logWarn(`Could not get insights for video ${video.id}:`, insightError?.response?.data || insightError);

				// Try to get basic metrics from the media object itself
				const date = new Date(video.timestamp).toISOString().split('T')[0];
				const existing = engagementByDay.get(date) || {impressions: 0, likes: 0, comments: 0};

				// Note: Basic Display API doesn't provide view counts or detailed metrics
				// This is a limitation of the API - you'd need Instagram Graph API for business accounts
				engagementByDay.set(date, {
					impressions: existing.impressions, // Not available in Basic Display API
					likes: existing.likes + (video.like_count || 0),
					comments: existing.comments + (video.comments_count || 0),
				});
			}
		}

		// Convert to array and sort by date (newest first)
		return Array.from(engagementByDay.entries()).sort(([a], [b]) => b.localeCompare(a));
	} catch (error) {
		throw new Error(`Failed to fetch Instagram video engagements: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
};
