import type { texts } from "../texts.ts";

export const sourceNames = {
  bili: "哔哩哔哩",
  heybox: "小黑盒",
  news: "资讯",
  museum: "克利夫兰艺术博物馆",
  nasa: "NASA 影像库",
};

export const levelKeys: Record<string, keyof typeof texts.defaults> = {
  title: "readTitles",
  feed: "readFeed",
  metadata: "readInfo",
  subtitles: "readSubtitles",
  filtered_comments: "readComments",
  discussion: "readDiscussion",
  article: "readArticle",
  storyboard_viewed: "readFrames",
  storyboard_available: "frameIndex",
  rss_excerpt: "readExcerpt",
  search_titles: "readTitles",
  collection_label: "collectionLabel",
  photo_caption: "photoCaption",
  image_viewed: "viewWork",
};
export const verbKeys: Record<string, keyof typeof texts.defaults> = {
  open: "readOpen",
  subtitles: "readSubtitles",
  frames: "readFrames",
  comments: "readComments",
  image: "readImage",
  browse: "readBrowse",
  search: "readSearch",
};

export const readingFailures: Record<string,string> = {
    no_results:"这次筛选没有匹配条目", end_of_article:"已经到正文末尾", unsupported_source:"这个来源已收起",
    no_subtitles:"没有可读字幕", end_of_subtitles:"已经到字幕末尾", no_frames:"没有可用分镜",
    end_of_frames:"已经到分镜末尾", no_visible_comments:"没有可见评论", needs_login:"需要登录",
    rate_limited:"来源暂时限流", network_error:"连接未成功", unavailable:"内容暂时不可用",
    unverified:"未留下读取结果", part_not_found:"找不到这个分集",
    frames_unseen:"这次没能看清分镜", image_unseen:"这次没能看清图片",
  };
