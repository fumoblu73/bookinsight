declare module 'google-trends-api' {
  interface TrendsOptions {
    keyword: string | string[]
    startTime?: Date
    endTime?: Date
    geo?: string
    granularTimeResolution?: boolean
  }
  const googleTrends: {
    interestOverTime(options: TrendsOptions): Promise<string>
    relatedQueries(options: TrendsOptions): Promise<string>
  }
  export default googleTrends
}
