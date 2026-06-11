import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Source,
    Subtitle
} from '@omss/framework';

export class VidSrcProvider extends BaseProvider {
    readonly id = 'vidsrc';
    readonly name = 'VidSrc';
    readonly enabled = true;
    readonly BASE_URL = 'https://vsembed.ru/';
    readonly BASE_URLS = [
        'https://vsembed.ru/',
        'https://vidsrcme.ru/',
        'https://vidsrc.to/'
    ];
    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
        Referer: this.BASE_URL
    };

    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv']
    };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    private async getSources(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        const errors: string[] = [];

        for (const baseUrl of this.BASE_URLS) {
            try {
                const result = await this.tryFetchFromBase(media, baseUrl);
                if (result) return result;
            } catch (e) {
                errors.push(
                    `${baseUrl}: ${e instanceof Error ? e.message : 'Unknown error'}`
                );
            }
        }

        return this.emptyResult(
            `All VidSrc mirrors failed: ${errors.join('; ')}`,
            media
        );
    }

    private async tryFetchFromBase(
        media: ProviderMediaObject,
        baseUrl: string
    ): Promise<ProviderResult | null> {
        const headers = {
            ...this.HEADERS,
            Referer: baseUrl
        };
        const pageUrl = this.buildPageUrl(media, baseUrl);

        const html = await this.fetchPage(pageUrl, headers);
        if (!html) return null;

        const secondUrl = this.extractSecondUrl(html);
        if (!secondUrl) return null;

        const secondHtml = await this.fetchPage(secondUrl.url, headers);
        if (!secondHtml) return null;

        const thirdUrl = this.extractThirdUrl(secondHtml, secondUrl.url);
        if (!thirdUrl) return null;

        const thirdHtml = await this.fetchPage(thirdUrl.url, headers);
        if (!thirdHtml) return null;

        const m3u8Urls = this.extractM3u8Urls(thirdHtml);
        if (!m3u8Urls || m3u8Urls.length === 0) return null;

        const sources: Source[] = m3u8Urls.map((url) => ({
            url: this.createProxyUrl(url, {
                ...headers,
                Referer: 'https://cloudnestra.com/',
                Origin: 'https://cloudnestra.com'
            }),
            type: 'hls',
            quality: 'Auto',
            audioTracks: [
                {
                    label: 'English',
                    language: 'eng'
                }
            ],
            provider: {
                id: this.id,
                name: this.name
            }
        }));

        return {
            sources,
            subtitles: [],
            diagnostics: []
        };
    }

    private buildPageUrl(media: ProviderMediaObject, baseUrl: string): string {
        if (media.type === 'movie') {
            return `${baseUrl}embed/movie?tmdb=${media.tmdbId}`;
        } else {
            return `${baseUrl}embed/tv?tmdb=${media.tmdbId}&season=${media.s}&episode=${media.e}`;
        }
    }

    private async fetchPage(
        url: string,
        headers: Record<string, string>
    ): Promise<string | null> {
        try {
            if (url.startsWith('//')) {
                url = 'https:' + url;
            }

            const response = await fetch(url, { headers });

            if (response.status !== 200) {
                return null;
            }

            return await response.text();
        } catch {
            return null;
        }
    }

    private extractSecondUrl(html: string): { url: string } | null {
        const src = html.match(
            /<iframe[^>]*\s+src=["']([^"']+)["'][^>]*>/i
        )?.[1];

        if (!src) {
            return null;
        }

        return { url: src };
    }

    private extractThirdUrl(
        html: string,
        secondUrl: string
    ): { url: string } | null {
        const relSrc = html.match(/src:\s*['"]([^'"]+)['"]/i)?.[1];
        if (!relSrc) {
            return null;
        }

        if (secondUrl.startsWith('//')) {
            secondUrl = 'https:' + secondUrl;
        }

        let url: string;
        try {
            url = new URL(relSrc, secondUrl).href;
        } catch {
            return null;
        }

        return { url };
    }

    private extractM3u8Urls(thirdHtml: string): string[] | null {
        const fileField = thirdHtml.match(/file\s*:\s*["']([^"']+)["']/i)?.[1];
        if (!fileField) return null;

        const playerDomains = new Map<string, string>();
        playerDomains.set('{v1}', 'neonhorizonworkshops.com');
        playerDomains.set('{v2}', 'wanderlynest.com');
        playerDomains.set('{v3}', 'orchidpixelgardens.com');
        playerDomains.set('{v4}', 'cloudnestra.com');

        const rawUrls = fileField.split(/\s+or\s+/i);

        const m3u8Urls = rawUrls.map((template) => {
            let url = template;
            for (const [placeholder, domain] of playerDomains.entries()) {
                url = url.replace(placeholder, domain);
            }
            if (url.includes('{') || url.includes('}')) {
                return null;
            }
            return url;
        });

        const filteredM3u8Urls = m3u8Urls.filter(
            (url): url is string => url !== null
        );

        return filteredM3u8Urls.length > 0 ? filteredM3u8Urls : null;
    }

    private emptyResult(
        message: string,
        media: ProviderMediaObject
    ): ProviderResult {
        return {
            sources: [],
            subtitles: [],
            diagnostics: [
                {
                    code: 'PROVIDER_ERROR',
                    message: `${this.name}: ${message}`,
                    field: '',
                    severity: 'error'
                }
            ]
        };
    }

    async healthCheck(): Promise<boolean> {
        for (const baseUrl of this.BASE_URLS) {
            try {
                const response = await fetch(baseUrl, {
                    method: 'HEAD',
                    headers: this.HEADERS
                });
                if (response.status === 200) return true;
            } catch {
                continue;
            }
        }
        return false;
    }
}
