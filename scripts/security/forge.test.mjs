import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import forge from 'node-forge';

test('RSA verification rejects nested DigestAlgorithm slack (CVE-2026-85393)', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const privateKey = forge.pki.privateKeyFromPem(keys.privateKey.export({ format: 'pem', type: 'pkcs1' }));
  const publicKey = forge.pki.publicKeyFromPem(keys.publicKey.export({ format: 'pem', type: 'pkcs1' }));
  const md = forge.md.sha256.create().update('synthetic regression fixture');
  const digest = md.digest().getBytes();
  assert.equal(publicKey.verify(digest, privateKey.sign(md)), true);
  const { asn1 } = forge;
  const element = (type, constructed, value) => asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
  const malformed = element(asn1.Type.SEQUENCE, true, [
    element(asn1.Type.SEQUENCE, true, [
      element(asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes()),
      element(asn1.Type.NULL, false, ''),
      element(asn1.Type.OCTETSTRING, false, 'unconsumed attacker-controlled data'),
    ]),
    element(asn1.Type.OCTETSTRING, false, digest),
  ]);
  const signature = forge.pki.rsa.encrypt(asn1.toDer(malformed).getBytes(), privateKey, 0x01);
  assert.throws(() => publicKey.verify(digest, signature), /DigestInfo/);
});
