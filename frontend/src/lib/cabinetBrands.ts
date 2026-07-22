// Provider attribution for the three cabinet seats — shared by the FinOcean
// home cards and the slide-in chat panel. Truthful, not decoration: each title
// names the exact model id behind that chair (the DM runs Qwen SERVED on
// NVIDIA, so its tooltip says so rather than implying NVIDIA authored it).
export const CABINET_MARK = {
  fm: {
    src: "/nvidia-logo.png",
    alt: "Powered by NVIDIA",
    title: "Foreign Minister runs on nvidia/nvidia-nemotron-nano-9b-v2",
    box: "h-12 max-w-[68px]", // full-bleed home card
    chip: "h-4 max-w-[34px]", // small chat chip
  },
  dm: {
    src: "/qwen-logo.png",
    alt: "Powered by Qwen 3.5",
    title: "Defence Minister runs on qwen/qwen3.5-122b-a10b (served on NVIDIA NIM)",
    box: "h-10 max-w-[122px]",
    chip: "h-4 max-w-[58px]",
  },
  pm: {
    src: "/openai-logo.png",
    alt: "Powered by OpenAI",
    title: "Prime Minister runs on openai/gpt-oss-120b",
    box: "h-[74px] max-w-[136px]",
    chip: "h-5 max-w-[64px]",
  },
} as const;

export type MinisterKey = keyof typeof CABINET_MARK;

export const ROLE_META: Record<MinisterKey, { title: string; mandate: string }> = {
  fm: { title: "Foreign Minister", mandate: "fiscal · CAD · inflation" },
  dm: { title: "Defence Minister", mandate: "naval · chokepoint · escalation" },
  pm: { title: "Prime Minister", mandate: "integrating decision" },
};
