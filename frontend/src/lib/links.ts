// Where the landing page's GitHub and demo-video buttons point. Both are empty until the repo and the video exist,
// and the buttons then fall back to pages that do: GitHub is hidden and "Watch demo" opens the dashboard.
//
// Set them where the app is built (a git-ignored .env.local, or the build environment); NEXT_PUBLIC_* values are
// read at build time:
//   NEXT_PUBLIC_REPO_URL=https://github.com/<owner>/<repo>
//   NEXT_PUBLIC_VIDEO_URL=https://<where the demo video is hosted>

export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "";
export const VIDEO_URL = process.env.NEXT_PUBLIC_VIDEO_URL ?? "";
