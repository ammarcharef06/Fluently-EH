#!/usr/bin/env python3
"""Inject an independently supplied build hash and a native streaming reader."""
from __future__ import annotations
import re
import sys
from pathlib import Path

def main() -> int:
    if len(sys.argv) != 2 or not re.fullmatch(r"[0-9a-f]{64}", sys.argv[1]):
        print("expected one lowercase 64-character SHA-256 argument", file=sys.stderr)
        return 2
    gradle_path = Path("android/app/build.gradle")
    if not gradle_path.is_file():
        raise SystemExit(f"missing generated file: {gradle_path}")
    gradle = gradle_path.read_text(encoding="utf-8")
    namespace_match = re.search(r'namespace\s*=\s*["\']([^"\']+)["\']', gradle)
    if not namespace_match:
        raise SystemExit("could not identify Android namespace in app/build.gradle")
    namespace = namespace_match.group(1)
    if "EXPECTED_PLACEHOLDER_SHA256" in gradle:
        raise SystemExit("BuildConfig hash field already exists; refusing an ambiguous patch")
    default_config = re.search(r"defaultConfig\s*\{", gradle)
    if not default_config:
        raise SystemExit("could not identify defaultConfig block")
    property_block = (
        default_config.group(0)
        + "\n        def expectedPlaceholderSha256 = project.findProperty('placeholderSha256')?.toString()"
        + "\n        if (expectedPlaceholderSha256 == null || !(expectedPlaceholderSha256 ==~ /[0-9a-f]{64}/)) {"
        + "\n            throw new GradleException('Missing or invalid -PplaceholderSha256 (expected 64 lowercase hex characters)')"
        + "\n        }"
        + """\n        buildConfigField "String", "EXPECTED_PLACEHOLDER_SHA256", '"' + expectedPlaceholderSha256 + '"'"""
    )
    gradle = gradle[:default_config.start()] + property_block + gradle[default_config.end():]
    features_match = re.search(r"buildFeatures\s*\{([^}]*)\}", gradle, flags=re.DOTALL)
    if features_match:
        if not re.search(r"buildConfig\s+true", features_match.group(1)):
            replacement = features_match.group(0)[:-1] + "\n        buildConfig true\n    }"
            gradle = gradle[:features_match.start()] + replacement + gradle[features_match.end():]
    else:
        android_block = re.search(r"android\s*\{", gradle)
        if not android_block:
            raise SystemExit("could not identify android block")
        gradle = gradle[:android_block.end()] + "\n    buildFeatures {\n        buildConfig true\n    }" + gradle[android_block.end():]
    gradle_path.write_text(gradle, encoding="utf-8")

    activities = list(Path("android/app/src/main/java").rglob("MainActivity.java"))
    if len(activities) != 1:
        raise SystemExit(f"expected exactly one generated MainActivity.java; found {len(activities)}")
    activity_path = activities[0]
    original = activity_path.read_text(encoding="utf-8")
    package_match = re.search(r"^package\s+([A-Za-z0-9_.]+);", original, flags=re.MULTILINE)
    if not package_match:
        raise SystemExit("could not identify MainActivity Java package")
    package = package_match.group(1)
    source = f'''package {package};

import android.os.Bundle;
import android.util.Log;
import {namespace}.BuildConfig;
import com.getcapacitor.BridgeActivity;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

public class MainActivity extends BridgeActivity {{
    private static final String TAG = "FLUENTLY_H2A";

    @Override
    public void onCreate(Bundle savedInstanceState) {{
        super.onCreate(savedInstanceState);
        verifyBundledPlaceholder();
    }}

    private void verifyBundledPlaceholder() {{
        try (InputStream input = getAssets().open("placeholder.bin")) {{
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {{
                digest.update(buffer, 0, count);
            }}
            StringBuilder hex = new StringBuilder(64);
            for (byte value : digest.digest()) {{
                hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            }}
            String actual = hex.toString();
            Log.i(TAG, "CHECKSUM:" + actual);
            Log.i(TAG, actual.equals(BuildConfig.EXPECTED_PLACEHOLDER_SHA256)
                ? "RESULT:MATCH" : "RESULT:MISMATCH");
        }} catch (Exception error) {{
            Log.e(TAG, "READ_ERROR:" + error.getClass().getSimpleName(), error);
        }}
    }}
}}
'''
    activity_path.write_text(source, encoding="utf-8")
    print(f"patched namespace={namespace}; activity_package={package}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
