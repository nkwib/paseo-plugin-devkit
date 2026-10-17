// Not imported by the entry: React in server code breaks the boundary rule.
import { useState } from "react";

export const leak = useState;
