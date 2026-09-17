import Piano from "@/components/Piano";

export default function Home() {
  return (
    <div className="flex h-full w-full flex-col bg-zinc-100">
      <main className="flex-1 p-2 sm:p-4">
        <Piano />
      </main>
    </div>
  );
}
