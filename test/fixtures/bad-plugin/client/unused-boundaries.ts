// Not imported by the entry: exercises the source-level boundary scan only.
import { readFileSync } from "node:fs";
import { GestureDetector } from "react-native-gesture-handler";

export const unused = [readFileSync, GestureDetector];
