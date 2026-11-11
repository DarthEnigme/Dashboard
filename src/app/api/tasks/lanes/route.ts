import { addLane, deleteLane, updateLane } from "@/lib/tasks/store";
import { partRoutes } from "../_shared";

export const dynamic = "force-dynamic";

/** POST { board, name }. PATCH { id, name?, collapsed?, index? }. DELETE ?id=: the lane goes, its tasks stay (with no lane). */
export const { POST, PATCH, DELETE } = partRoutes({ create: addLane, update: updateLane, remove: deleteLane });
