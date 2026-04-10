import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';

test.describe('getSelector — Appium platform formatting', () => {

  const mockData = {
    pages: [
      {
        name: 'TestPageAndroid',
        platform: 'android',
        elements: [
          { elementName: 'byAccessibilityId', selector: { 'accessibility id': 'Login' } },
          { elementName: 'byXpath', selector: { xpath: '//android.widget.Button' } },
          { elementName: 'byId', selector: { id: 'submit-btn' } },
          { elementName: 'byUiAutomator', selector: { uiautomator: 'new UiSelector().text("Submit")' } },
          { elementName: 'byText', selector: { text: 'Submit' } },
          { elementName: 'byClassName', selector: { 'class name': 'android.widget.EditText' } },
          { elementName: 'byUnknown', selector: { nativeId: 'com.example.button' } },
        ],
      },
      {
        name: 'TestPageIOS',
        platform: 'ios',
        elements: [
          { elementName: 'byAccessibilityId', selector: { 'accessibility id': 'MyButton' } },
          { elementName: 'byXpath', selector: { xpath: '//XCUIElementTypeButton' } },
          { elementName: 'byPredicate', selector: { predicate: 'label == "Login"' } },
          { elementName: 'byClassChain', selector: { 'class chain': '**/XCUIElementTypeButton' } },
          { elementName: 'byText', selector: { text: 'Submit' } },
          { elementName: 'byClassName', selector: { 'class name': 'XCUIElementTypeTextField' } },
        ],
      },
    ],
  };

  test.describe('Android', () => {
    const repo = new ElementRepository({} as any, mockData);

    test('accessibility id → ~value', () => {
      expect(repo.getSelector('byAccessibilityId', 'TestPageAndroid')).toBe('~Login');
    });

    test('xpath → raw value', () => {
      expect(repo.getSelector('byXpath', 'TestPageAndroid')).toBe('//android.widget.Button');
    });

    test('id → #value', () => {
      expect(repo.getSelector('byId', 'TestPageAndroid')).toBe('#submit-btn');
    });

    test('uiautomator → android=value', () => {
      expect(repo.getSelector('byUiAutomator', 'TestPageAndroid')).toBe('android=new UiSelector().text("Submit")');
    });

    test('text → UiSelector text query', () => {
      expect(repo.getSelector('byText', 'TestPageAndroid')).toBe('android=new UiSelector().text("Submit")');
    });

    test('class name → raw value', () => {
      expect(repo.getSelector('byClassName', 'TestPageAndroid')).toBe('android.widget.EditText');
    });

    test('unknown strategy → raw value', () => {
      expect(repo.getSelector('byUnknown', 'TestPageAndroid')).toBe('com.example.button');
    });
  });

  test.describe('iOS', () => {
    const repo = new ElementRepository({} as any, mockData);

    test('accessibility id → ~value', () => {
      expect(repo.getSelector('byAccessibilityId', 'TestPageIOS')).toBe('~MyButton');
    });

    test('xpath → raw value', () => {
      expect(repo.getSelector('byXpath', 'TestPageIOS')).toBe('//XCUIElementTypeButton');
    });

    test('predicate → -ios predicate string:value', () => {
      expect(repo.getSelector('byPredicate', 'TestPageIOS')).toBe('-ios predicate string:label == "Login"');
    });

    test('class chain → -ios class chain:value', () => {
      expect(repo.getSelector('byClassChain', 'TestPageIOS')).toBe('-ios class chain:**/XCUIElementTypeButton');
    });

    test('text → -ios predicate string label', () => {
      expect(repo.getSelector('byText', 'TestPageIOS')).toBe('-ios predicate string:label == "Submit"');
    });

    test('class name → raw value', () => {
      expect(repo.getSelector('byClassName', 'TestPageIOS')).toBe('XCUIElementTypeTextField');
    });
  });

  test.describe('Android — new strategies', () => {
    const newStrategyData = {
      pages: [{
        name: 'TestPageAndroid',
        platform: 'android',
        elements: [
          { elementName: 'byTagName', selector: { 'tag name': 'button' } },
          { elementName: 'byName', selector: { name: 'username' } },
          { elementName: 'byDataMatcher', selector: { 'android data matcher': '{"name":"Title"}' } },
          { elementName: 'byViewMatcher', selector: { 'android view matcher': '{"id":"btn"}' } },
          { elementName: 'byViewTag', selector: { 'android view tag': 'my-tag' } },
        ],
      }],
    };
    const repo = new ElementRepository({} as any, newStrategyData);

    test('tag name → raw value', () => {
      expect(repo.getSelector('byTagName', 'TestPageAndroid')).toBe('button');
    });

    test('name → raw value', () => {
      expect(repo.getSelector('byName', 'TestPageAndroid')).toBe('username');
    });

    test('android data matcher → -android datamatcher:value', () => {
      expect(repo.getSelector('byDataMatcher', 'TestPageAndroid')).toBe('-android datamatcher:{"name":"Title"}');
    });

    test('android view matcher → -android viewmatcher:value', () => {
      expect(repo.getSelector('byViewMatcher', 'TestPageAndroid')).toBe('-android viewmatcher:{"id":"btn"}');
    });

    test('android view tag → -android viewtag:value', () => {
      expect(repo.getSelector('byViewTag', 'TestPageAndroid')).toBe('-android viewtag:my-tag');
    });
  });

  test.describe('camelCase strategy aliases', () => {
    const camelCaseData = {
      pages: [
        {
          name: 'TestPageAndroid',
          platform: 'android',
          elements: [
            { elementName: 'byAccessibilityId', selector: { accessibilityId: 'LoginBtn' } },
            { elementName: 'byUIAutomator', selector: { androidUIAutomator: 'new UiSelector().text("Go")' } },
            { elementName: 'byClassName', selector: { className: 'android.widget.EditText' } },
            { elementName: 'byTagName', selector: { tagName: 'button' } },
            { elementName: 'byDataMatcher', selector: { androidDataMatcher: '{"name":"Title"}' } },
            { elementName: 'byViewMatcher', selector: { androidViewMatcher: '{"id":"btn"}' } },
            { elementName: 'byViewTag', selector: { androidViewTag: 'my-tag' } },
          ],
        },
        {
          name: 'TestPageIOS',
          platform: 'ios',
          elements: [
            { elementName: 'byPredicate', selector: { iOSNsPredicateString: 'label == "Login"' } },
            { elementName: 'byClassChain', selector: { iOSClassChain: '**/XCUIElementTypeButton' } },
            { elementName: 'byAccessibilityId', selector: { accessibilityId: 'MyButton' } },
            { elementName: 'byClassName', selector: { className: 'XCUIElementTypeTextField' } },
          ],
        },
      ],
    };

    test.describe('Android camelCase', () => {
      const repo = new ElementRepository({} as any, camelCaseData);

      test('accessibilityId → ~value', () => {
        expect(repo.getSelector('byAccessibilityId', 'TestPageAndroid')).toBe('~LoginBtn');
      });

      test('androidUIAutomator → android=value', () => {
        expect(repo.getSelector('byUIAutomator', 'TestPageAndroid')).toBe('android=new UiSelector().text("Go")');
      });

      test('className → raw value', () => {
        expect(repo.getSelector('byClassName', 'TestPageAndroid')).toBe('android.widget.EditText');
      });

      test('tagName → raw value', () => {
        expect(repo.getSelector('byTagName', 'TestPageAndroid')).toBe('button');
      });

      test('androidDataMatcher → -android datamatcher:value', () => {
        expect(repo.getSelector('byDataMatcher', 'TestPageAndroid')).toBe('-android datamatcher:{"name":"Title"}');
      });

      test('androidViewMatcher → -android viewmatcher:value', () => {
        expect(repo.getSelector('byViewMatcher', 'TestPageAndroid')).toBe('-android viewmatcher:{"id":"btn"}');
      });

      test('androidViewTag → -android viewtag:value', () => {
        expect(repo.getSelector('byViewTag', 'TestPageAndroid')).toBe('-android viewtag:my-tag');
      });
    });

    test.describe('iOS camelCase', () => {
      const repo = new ElementRepository({} as any, camelCaseData);

      test('iOSNsPredicateString → -ios predicate string:value', () => {
        expect(repo.getSelector('byPredicate', 'TestPageIOS')).toBe('-ios predicate string:label == "Login"');
      });

      test('iOSClassChain → -ios class chain:value', () => {
        expect(repo.getSelector('byClassChain', 'TestPageIOS')).toBe('-ios class chain:**/XCUIElementTypeButton');
      });

      test('accessibilityId → ~value', () => {
        expect(repo.getSelector('byAccessibilityId', 'TestPageIOS')).toBe('~MyButton');
      });

      test('className → raw value', () => {
        expect(repo.getSelector('byClassName', 'TestPageIOS')).toBe('XCUIElementTypeTextField');
      });
    });
  });

  test.describe('Unknown platform', () => {
    const unknownData = {
      pages: [{
        name: 'TestPageWindows',
        platform: 'windows',
        elements: [
          { elementName: 'byText', selector: { text: 'Submit' } },
        ],
      }],
    };
    const repo = new ElementRepository({} as any, unknownData);

    test('text for unknown platform → raw value', () => {
      expect(repo.getSelector('byText', 'TestPageWindows')).toBe('Submit');
    });
  });
});
