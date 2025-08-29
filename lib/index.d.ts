import { Context } from 'koishi';
import { Config } from './config';
export declare const name = "sauce-aggregator";
export declare const using: any[];
export declare const inject: string[];
export { Config };
export declare const usage = "\n\u6307\u4EE4: sauce [\u56FE\u7247]\n\u522B\u540D: \u641C\u56FE, soutu\n\u9009\u9879: --all / -a (\u641C\u7D22\u5168\u90E8\u5F15\u64CE)\n\n\u652F\u6301\u76F4\u63A5\u53D1\u9001\u56FE\u7247\u3001\u56DE\u590D\u56FE\u7247\u6216\u53D1\u9001\u56FE\u7247\u94FE\u63A5\u3002\n";
export declare function apply(ctx: Context, config: Config): void;
