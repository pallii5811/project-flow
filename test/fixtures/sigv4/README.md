Signature Version 4 test vectors, copied unchanged from the suite AWS publishes:
<https://github.com/awslabs/aws-c-auth/tree/main/tests/aws-signing-test-suite/v4>
(Apache License 2.0, Amazon.com, Inc. or its affiliates), fetched 2026-09-19.

Each folder: `context.json` (credentials, region, service, time, whether the path is
normalised and the body signed), `request.txt` (the request), and what a correct signer
produces: `header-canonical-request.txt`, `header-string-to-sign.txt`, `header-signature.txt`.

`test/sigv4.test.ts` signs every request with `scripts/lib/sigv4.mjs` and compares all
three. The S3-specific examples (one-time path encoding, `x-amz-content-sha256`) come from
the Amazon S3 API reference and are written in the test itself.
