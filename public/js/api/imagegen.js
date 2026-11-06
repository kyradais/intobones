/* js/api/imagegen.js — Image generation through the image model (POST images/generations).
 * State: reads S.models.imageId and S.options (watermark, promptExtend)
 * Gotchas: a reference image is sent in the "image" field; whether the provider honors it for inpainting depends on
 *          the model. Results may arrive as b64_json or as a URL (downloaded through the proxy).
 *
 * @auto-deps-begin
 * Defines: buildImageBody, generateImage, imageFromResponse
 * Uses: ApiError, Limiters, S, apiFetch, fetchRemoteImage
 * @auto-deps-end
 */
function buildImageBody(prompt, refImage) {
  const body = {
    model: S.models.imageId,
    prompt,
    n: 1,
    size: 'auto',
    quality: 'auto',
    background: 'auto',
    image_detail: 'high',
    output_format: 'png',
    watermark: !!S.options.watermark,
    prompt_extend: !!S.options.promptExtend
  };
  if (refImage) body.image = refImage;
  return body;
}

async function imageFromResponse(resp) {
  const item = resp && Array.isArray(resp.data) ? resp.data[0] : null;
  if (!item) throw new ApiError('badjson', 'The image API returned no image.');
  if (item.b64_json) {
    return item.b64_json.startsWith('data:') ? item.b64_json : 'data:image/png;base64,' + item.b64_json;
  }
  if (item.url) return item.url.startsWith('data:') ? item.url : fetchRemoteImage(item.url);
  throw new ApiError('badjson', 'The image API response had neither b64_json nor url.');
}

async function generateImage(prompt, refImage) {
  if (!S.models.imageId) throw new ApiError('config', 'Select an image model first.');
  const body = buildImageBody(prompt, refImage);
  const resp = await Limiters.image.schedule(({ signal }) => apiFetch('images/generations', { method: 'POST', body, signal }));
  return imageFromResponse(resp);
}
