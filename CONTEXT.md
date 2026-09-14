# File assets

This context separates a user's file from the temporary bytes they upload and the permanent representations the system keeps.

## Core model

**File asset**:
A user's file in the system. It exists before its bytes arrive and later points to the representations clients can use.
_Avoid_: Media asset, uploaded file

**Upload session**:
One attempt to supply the bytes for a file asset.
_Avoid_: Upload, file asset

**Uploaded object**:
The temporary bytes supplied through an upload session. Preparation uses them as input; they are not an asset variant.
_Avoid_: Original variant

**Asset variant**:
A permanent representation of a file asset that clients can retrieve. Documents have an unchanged variant; images have display and download variants.
_Avoid_: Asset object, file version

## Preparation

**Handling mode**:
The caller's choice to preserve an upload as a document or prepare it as an image. It describes intended use, not the uploaded object's MIME type.
_Avoid_: File type, MIME type

**Document**:
A file asset kept byte for byte. Image bytes may be handled as a document when the caller wants the original file preserved.

**Image**:
A file asset prepared into display and download variants.

**Preparation**:
The work that turns an uploaded object into the asset variants clients can retrieve.

**Processing profile**:
A named, versioned set of image variants and the rules for producing them.
