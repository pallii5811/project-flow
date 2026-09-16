import { notFound } from "next/navigation";

export default function SceneGraphDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#0B0B0C",
        color: "#A8A69F",
        padding: 24,
        textAlign: "center",
      }}
    >
      <p>Scene Graph inspector (mobile)</p>
    </main>
  );
}
