export const AI_AVATAR =
  "https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=900&q=80";
export const TAXPAYER_AVATAR = "/assets/illustrations/avatar-thumbnails/Avatar Number=01.webp";
export const ACCOUNTANT_AVATAR = "/assets/illustrations/avatar-thumbnails/Avatar Number=02.webp";

export const AVATAR_OPTIONS = [
  "/assets/illustrations/avatar-thumbnails/Avatar Number=01.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=02.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=03.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=04.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=05.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=06.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=07.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=08.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=09.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=10.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=11.webp",
  "/assets/illustrations/avatar-thumbnails/Avatar Number=12.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2010.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2017.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2018.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2022.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2034.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2050.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2054.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2055.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%2056.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%207.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%208.webp",
  "/assets/illustrations/avatar-thumbnails/FREE%20-%209.webp",
];

export function resolveAvatar(photo: string | null | undefined, fallback: string) {
  return photo && photo.trim().length > 0 ? photo : fallback;
}
