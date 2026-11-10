import { appShell } from "@/lib/appPage";
import { TasksPage } from "@/components/tasks/TasksPage";

export const dynamic = "force-dynamic";

export default async function Tasks() {
  const { background } = await appShell("tasks");
  return (
    <>
      {background}
      <TasksPage />
    </>
  );
}
