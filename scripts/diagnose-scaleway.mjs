const secretKey = process.env.SCW_SECRET_KEY;
const accessKey = process.env.SCW_ACCESS_KEY;
const projectId = process.env.SCW_PROJECT_ID;
const zone = process.env.SCW_ZONE || "fr-par-1";

console.log("=== SCALEWAY DIAGNOSTICS ===");
console.log("Configured Zone:", zone);
console.log("SCW_ACCESS_KEY:", accessKey ? `${accessKey.slice(0, 6)}... (${accessKey.length} chars)` : "NOT SET");
console.log("SCW_PROJECT_ID:", projectId ? `${projectId.slice(0, 8)}... (${projectId.length} chars)` : "NOT SET");

async function req(name, method, url) {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "X-Auth-Token": secretKey,
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // ignore non-json responses
    }
    console.log(`[${res.status}] ${name} ->`, json ? JSON.stringify(json) : text.slice(0, 200));
    return { status: res.status, ok: res.ok, data: json };
  } catch (err) {
    console.log(`[ERR] ${name} -> ${err.message}`);
    return { status: 0, ok: false, error: err.message };
  }
}

if (accessKey) {
  await req("Get API Key Info", "GET", `https://api.scaleway.com/iam/v1alpha1/api-keys/${encodeURIComponent(accessKey)}`);
}

const directProject = await req("Get Project by SCW_PROJECT_ID", "GET", `https://api.scaleway.com/account/v3/projects/${encodeURIComponent(projectId)}`);

if (directProject?.data?.organization_id) {
  const orgId = directProject.data.organization_id;
  await req("List Projects in Org", "GET", `https://api.scaleway.com/account/v3/projects?organization_id=${encodeURIComponent(orgId)}`);
} else {
  // Maybe SCW_PROJECT_ID is actually an organization ID?
  await req("List Projects using SCW_PROJECT_ID as org_id", "GET", `https://api.scaleway.com/account/v3/projects?organization_id=${encodeURIComponent(projectId)}`);
}

await req("List Applications", "GET", `https://api.scaleway.com/iam/v1alpha1/applications`);
await req("List Policies", "GET", `https://api.scaleway.com/iam/v1alpha1/policies`);
console.log("=== END DIAGNOSTICS ===");
