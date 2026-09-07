// Built-in components (section 9), written in Mark and compiled with the project.
export const BUILTINS: Record<string, string> = {
  Slider: `prop value = 0
prop onValueChange = {}
prop min = 0
prop max = 1
prop step = 0.01
prop label = ""
<label class="mk-slider">
if label != "" {
<span class="mk-slider-label">{label}</span>
}
<input type="range" min={min} max={max} step={step} value=$value />
<output class="mk-slider-value">{value}</output>
</label>
`,
  Stepper: `prop onTap = {}
prop label = "+"
<button type="button" class="mk-stepper" onTap={onTap}>{label}</button>
`,
  Button: `prop onTap = {}
prop disabled = false
<button type="button" class="mk-button" disabled={disabled} onTap={onTap}><slot /></button>
`,
  Toggle: `prop value = false
prop onValueChange = {}
prop label = ""
<label class="mk-toggle"><input type="checkbox" checked=$value /> {label}</label>
`,
  Input: `prop value = ""
prop onValueChange = {}
prop type = "text"
prop placeholder = ""
<input class="mk-input" type={type} placeholder={placeholder} value=$value />
`,
  Select: `prop value = ""
prop onValueChange = {}
prop options = []
<select class="mk-select" value=$value>
for o in options {
<option value={o.value == undefined ? o : o.value} selected={(o.value == undefined ? o : o.value) == value}>{o.label == undefined ? o : o.label}</option>
}
</select>
`,
  Fragment: `<slot />
`,
  Math: `prop tex = ""
prop display = false
`,
  Link: `prop href = "/"
prop active = "current"
let cur = Page.path == href || (href != "/" && Page.path.startsWith(href + "/"))
<a href={href} class={active} if cur><slot /></a>
`,
};
