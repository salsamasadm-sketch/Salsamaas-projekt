#!/usr/bin/env bash
# Einmalige Einrichtung: GitHub darf die App "salsamas-cockpit" live stellen – und sonst nichts.
# Ausfuehren in der Google Cloud Shell (https://shell.cloud.google.com) als Projekt-Inhaber:
#   bash setup-github-deploy.sh
# Keine Schluessel werden erzeugt: Google vertraut nur dem GitHub-Projekt
# salsamasadm-sketch/Salsamaas-projekt, und nur dem Zweig "main".
set -euo pipefail

PROJECT=salsamas
PN=807195863742
REGION=europe-west3
REPO="salsamasadm-sketch/Salsamaas-projekt"
SA="github-deploy@${PROJECT}.iam.gserviceaccount.com"
gcloud config set project "$PROJECT" >/dev/null

echo "1/5 Dienste einschalten"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

echo "2/5 Konto 'github-deploy' anlegen (darf nur die App aktualisieren)"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create github-deploy --display-name="GitHub: App live stellen (nur salsamas-cockpit)"

echo "3/5 Vertrauen zu GitHub (nur dieses Projekt, nur Zweig main)"
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe salsamas-repo --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc salsamas-repo --location=global --workload-identity-pool=github \
    --display-name="Salsamaas-projekt" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${REPO}' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PN}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}" --format=none

echo "4/5 Minimale Rechte: nur Cloud-Run-Dienst salsamas-cockpit aktualisieren + bauen"
gcloud run services add-iam-policy-binding salsamas-cockpit --region "$REGION" --member="serviceAccount:${SA}" --role=roles/run.developer --format=none
for ROLE in roles/cloudbuild.builds.editor roles/serviceusage.serviceUsageConsumer roles/artifactregistry.writer roles/run.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${SA}" --role="$ROLE" --condition=None --format=none
done
gcloud storage buckets add-iam-policy-binding "gs://run-sources-${PROJECT}-${REGION}" --member="serviceAccount:${SA}" --role=roles/storage.objectAdmin >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://run-sources-${PROJECT}-${REGION}" --member="serviceAccount:${SA}" --role=roles/storage.legacyBucketReader >/dev/null
for TARGET in "cockpit-run@${PROJECT}.iam.gserviceaccount.com" "${PN}-compute@developer.gserviceaccount.com"; do
  gcloud iam service-accounts add-iam-policy-binding "$TARGET" --member="serviceAccount:${SA}" --role=roles/iam.serviceAccountUser --format=none
done

# Quellcode-Ablage finden (gcloud run deploy --source listet die Buckets)
gcloud iam roles describe runSourceUploader --project="$PROJECT" >/dev/null 2>&1 || \
  gcloud iam roles create runSourceUploader --project="$PROJECT" --title="Run Source Upload (nur Ablage finden)" --permissions=storage.buckets.list,storage.buckets.get --stage=GA
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${SA}" --role="projects/${PROJECT}/roles/runSourceUploader" --condition=None --format=none

echo "5/5 Fertig."
echo "GitHub stellt die App ab jetzt bei jedem Push auf 'main' automatisch live (nach erfolgreichen Tests)."
