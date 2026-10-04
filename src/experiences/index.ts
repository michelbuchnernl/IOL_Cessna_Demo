import type { ExperienceConfig } from "../types/experience";
import { cessnaExperience } from "./cessnaExperience";
import { klaslokaalExperience } from "./klaslokaalExperience";

export const experiences: ExperienceConfig[] = [klaslokaalExperience, cessnaExperience];
