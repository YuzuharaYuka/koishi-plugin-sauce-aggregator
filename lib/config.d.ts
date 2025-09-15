import { Schema, Context, h } from 'koishi';
import { Buffer } from 'buffer';
export type SearchEngineName = 'saucenao' | 'iqdb' | 'tracemoe' | 'yandex' | 'ascii2d' | 'soutubot';
export type EnhancerName = 'yandere' | 'gelbooru' | 'danbooru' | 'pixiv';
export interface SearchOptions {
    imageUrl: string;
    imageBuffer: Buffer;
    fileName: string;
    maxResults: number;
}
export declare namespace Searcher {
    interface Result {
        thumbnail: string;
        similarity: number;
        url: string;
        source?: string;
        author?: string;
        time?: string;
        details?: string[];
        coverImage?: string;
        videoPreview?: ArrayBuffer;
    }
}
export interface EnhancedResult {
    details: h[];
    imageBuffer?: Buffer;
    imageType?: string;
}
export interface DebugConfig {
    enabled: boolean;
    logApiResponses: (SearchEngineName | EnhancerName)[];
}
export interface PuppeteerConfig {
    persistentBrowser: boolean;
    browserCloseTimeout: number;
    browserLaunchTimeout: number;
    chromeExecutablePath: string;
}
export declare abstract class Enhancer<T = any> {
    ctx: Context;
    config: T;
    debugConfig: DebugConfig;
    abstract name: EnhancerName;
    constructor(ctx: Context, config: T, debugConfig: DebugConfig);
    abstract enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
}
export declare abstract class Searcher<T = any> {
    ctx: Context;
    config: T;
    debugConfig: DebugConfig;
    abstract name: SearchEngineName;
    constructor(ctx: Context, config: T, debugConfig: DebugConfig);
    abstract search(options: SearchOptions): Promise<Searcher.Result[]>;
}
export interface Config {
    order: {
        engine: SearchEngineName;
        enabled: boolean;
    }[];
    enhancerOrder: {
        engine: EnhancerName;
        enabled: boolean;
    }[];
    confidenceThreshold: number;
    maxResults: number;
    promptTimeout: number;
    requestTimeout: number;
    puppeteer: PuppeteerConfig;
    debug: DebugConfig;
    saucenao: SauceNAO.Config;
    tracemoe: TraceMoe.Config;
    iqdb: IQDB.Config;
    yandex: Yandex.Config;
    yandere: YandeRe.Config;
    gelbooru: Gelbooru.Config;
    danbooru: Danbooru.Config;
    ascii2d: Ascii2D.Config;
    soutubot: SoutuBot.Config;
    pixiv: Pixiv.Config;
}
export declare namespace SauceNAO {
    interface Config {
        apiKeys: string[];
        confidenceThreshold?: number;
    }
}
export declare namespace TraceMoe {
    interface Config {
        sendVideoPreview: boolean;
        confidenceThreshold?: number;
    }
}
export declare namespace IQDB {
    interface Config {
        confidenceThreshold?: number;
    }
}
export declare namespace Yandex {
    interface Config {
        alwaysAttach: boolean;
        domain: 'ya.ru' | 'yandex.com';
    }
}
export declare namespace YandeRe {
    interface Config {
        postQuality: 'jpeg' | 'sample' | 'original';
        maxRating: 's' | 'q' | 'e';
    }
}
export declare namespace Gelbooru {
    interface Config {
        keyPairs: {
            userId: string;
            apiKey: string;
        }[];
        postQuality: 'original' | 'sample' | 'preview';
        maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit';
    }
}
export declare namespace Danbooru {
    interface Config {
        keyPairs: {
            username: string;
            apiKey: string;
        }[];
        postQuality: 'original' | 'sample' | 'preview';
        maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit';
    }
}
export declare namespace Ascii2D {
    interface Config {
        alwaysAttach: boolean;
    }
}
export declare namespace SoutuBot {
    interface Config {
        confidenceThreshold?: number;
        maxHighConfidenceResults?: number;
    }
}
export declare namespace Pixiv {
    interface Config {
        refreshToken: string;
        clientId: string;
        clientSecret: string;
        postQuality: 'original' | 'large' | 'medium';
        allowR18: boolean;
    }
}
export declare const Config: Schema<Config>;
