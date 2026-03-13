# pw-element-repository (RAG Context)

**Purpose:** A JSON-based locator repository for Playwright. It externalizes selectors (CSS, XPath, ID, Text) from test code, allowing tests to reference elements by `pageName` and `elementName` strings.

## 🏗️ JSON Schema Requirement

The repository requires a specific JSON structure to function:

```json
{
  "pages": [
    {
      "name": "StringPageName",
      "elements": [
        {
          "elementName": "StringElementName",
          "selector": { 
            "css": "selector", 
            "xpath": "selector", 
            "id": "id", 
            "text": "text" 
          }
        }
      ]
    }
  ]
}

```

## 🚀 Initialization

```ts
import { ElementRepository } from 'pw-element-repository';

// Initialize via file path or imported JSON object
// Constructor: (pathOrData: string | object, timeout?: number)
const repo = new ElementRepository('path/to/locators.json', 15000);
```

## 🛠️ API Reference

All retrieval methods are **asynchronous** and return Playwright `Locator` objects.

### Element Retrieval

* **`get(page, pageName, elementName)`**: Returns a single `Locator`. Waits for DOM attachment based on repository timeout.
* **`getAll(page, pageName, elementName)`**: Returns an array of resolved handles (`Locator[]`) for iteration.
* **`getRandom(page, pageName, elementName, strict?)`**: Counts matches and returns one random `Locator`. Waits for visibility.
* **`getByText(page, pageName, elementName, desiredText, strict?)`**: Returns the first `Locator` matching the selector that contains `desiredText`.

### Utilities

* **`getSelector(pageName, elementName)`**: **Synchronous**. Returns the raw string selector (e.g., `css=.btn`) for debugging or native Playwright APIs requiring strings.

---

## 🤖 AI / LLM Implementation Note

When generating tests using these two packages:

1. **Reference the JSON:** Use the `pageName` and `elementName` defined in the `locators.json`.
2. **Use `Steps`:** Prefer `steps.click('Page', 'Element')` over `repo.get` + `locator.click()`.
3. **Avoid Selectors:** Do not hardcode CSS/XPath in the test script; add them to the JSON repository instead.