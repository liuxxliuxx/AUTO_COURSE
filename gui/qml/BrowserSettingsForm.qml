import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ScrollView {
    id: root

    property var theme

    clip: true
    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
    ScrollBar.vertical.policy: ScrollBar.AsNeeded

    function textColor(role) {
        if (theme && theme[role])
            return theme[role]
        return role === "textSecondary" ? "#657286" : "#1F2A37"
    }

    function savePath(key, value) {
        if (bridge)
            bridge.save_setting(key, value || "")
    }

    ColumnLayout {
        width: root.availableWidth
        spacing: 16

        Text {
            Layout.fillWidth: true
            text: "浏览器设置"
            color: root.textColor("textPrimary")
            elide: Text.ElideRight
            font {
                family: "Microsoft YaHei UI"
                pixelSize: 20
                weight: Font.DemiBold
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: "#1F000000"
            opacity: 0.14
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 8

            Text {
                Layout.fillWidth: true
                text: "Chrome 路径"
                color: root.textColor("textSecondary")
                elide: Text.ElideRight
                font {
                    family: "Microsoft YaHei UI"
                    pixelSize: 12
                    weight: Font.Medium
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 10

                TextField {
                    id: chromeField
                    Layout.fillWidth: true
                    Layout.preferredHeight: 42
                    text: bridge ? bridge.get_setting("chrome_binary") || "" : ""
                    selectByMouse: true
                    color: root.textColor("textPrimary")
                    placeholderText: "留空时自动检测或下载"
                    placeholderTextColor: "#8A96A8"
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 13
                    }
                    onEditingFinished: root.savePath("chrome_binary", text)
                    background: Rectangle {
                        radius: 10
                        color: chromeField.activeFocus ? "#F4FFFFFF" : "#70FFFFFF"
                        border.width: 1
                        border.color: chromeField.activeFocus ? "#6B8EFF" : "#72FFFFFF"

                        Behavior on color {
                            ColorAnimation { duration: 150 }
                        }
                    }
                }

                Button {
                    id: chromeBrowseButton
                    Layout.preferredWidth: 82
                    Layout.preferredHeight: 42
                    text: "选择"
                    onClicked: {
                        var path = bridge ? bridge.browse_file("chrome") : ""
                        if (path) {
                            chromeField.text = path
                            root.savePath("chrome_binary", path)
                        }
                    }
                    contentItem: Text {
                        text: chromeBrowseButton.text
                        color: chromeBrowseButton.hovered ? "#FFFFFF" : "#2E5AA7"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font {
                            family: "Microsoft YaHei UI"
                            pixelSize: 13
                            weight: Font.DemiBold
                        }
                    }
                    background: Rectangle {
                        radius: 10
                        color: chromeBrowseButton.hovered ? "#5B8DEF" : "#C8FFFFFF"
                        border.width: 1
                        border.color: "#84FFFFFF"

                        Behavior on color {
                            ColorAnimation { duration: 150 }
                        }
                    }
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 8

            Text {
                Layout.fillWidth: true
                text: "ChromeDriver 路径"
                color: root.textColor("textSecondary")
                elide: Text.ElideRight
                font {
                    family: "Microsoft YaHei UI"
                    pixelSize: 12
                    weight: Font.Medium
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 10

                TextField {
                    id: driverField
                    Layout.fillWidth: true
                    Layout.preferredHeight: 42
                    text: bridge ? bridge.get_setting("chromedriver_binary") || "" : ""
                    selectByMouse: true
                    color: root.textColor("textPrimary")
                    placeholderText: "留空时自动检测"
                    placeholderTextColor: "#8A96A8"
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 13
                    }
                    onEditingFinished: root.savePath("chromedriver_binary", text)
                    background: Rectangle {
                        radius: 10
                        color: driverField.activeFocus ? "#F4FFFFFF" : "#70FFFFFF"
                        border.width: 1
                        border.color: driverField.activeFocus ? "#6B8EFF" : "#72FFFFFF"

                        Behavior on color {
                            ColorAnimation { duration: 150 }
                        }
                    }
                }

                Button {
                    id: driverBrowseButton
                    Layout.preferredWidth: 82
                    Layout.preferredHeight: 42
                    text: "选择"
                    onClicked: {
                        var path = bridge ? bridge.browse_file("chromedriver") : ""
                        if (path) {
                            driverField.text = path
                            root.savePath("chromedriver_binary", path)
                        }
                    }
                    contentItem: Text {
                        text: driverBrowseButton.text
                        color: driverBrowseButton.hovered ? "#FFFFFF" : "#2E5AA7"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font {
                            family: "Microsoft YaHei UI"
                            pixelSize: 13
                            weight: Font.DemiBold
                        }
                    }
                    background: Rectangle {
                        radius: 10
                        color: driverBrowseButton.hovered ? "#5B8DEF" : "#C8FFFFFF"
                        border.width: 1
                        border.color: "#84FFFFFF"

                        Behavior on color {
                            ColorAnimation { duration: 150 }
                        }
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Button {
                id: detectButton
                Layout.preferredWidth: 118
                Layout.preferredHeight: 42
                text: "自动检测"
                onClicked: {
                    if (bridge) {
                        var result = bridge.auto_detect_chrome()
                        chromeField.text = result.chrome || chromeField.text
                        driverField.text = result.driver || driverField.text
                        statusText.text = result.status || "检测完成"
                    }
                }
                contentItem: Text {
                    text: detectButton.text
                    color: "#FFFFFF"
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 13
                        weight: Font.DemiBold
                    }
                }
                background: Rectangle {
                    radius: 10
                    color: detectButton.pressed ? "#2757C8" : (detectButton.hovered ? "#4F7FF2" : "#5B8DEF")

                    Behavior on color {
                        ColorAnimation { duration: 150 }
                    }
                }
            }

            Button {
                id: clearButton
                Layout.preferredWidth: 82
                Layout.preferredHeight: 42
                text: "清空"
                onClicked: {
                    chromeField.text = ""
                    driverField.text = ""
                    root.savePath("chrome_binary", "")
                    root.savePath("chromedriver_binary", "")
                    statusText.text = "已清空，启动时将自动检测"
                }
                contentItem: Text {
                    text: clearButton.text
                    color: clearButton.hovered ? "#FFFFFF" : "#2E5AA7"
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 13
                        weight: Font.DemiBold
                    }
                }
                background: Rectangle {
                    radius: 10
                    color: clearButton.hovered ? "#5B8DEF" : "#C8FFFFFF"
                    border.width: 1
                    border.color: "#84FFFFFF"

                    Behavior on color {
                        ColorAnimation { duration: 150 }
                    }
                }
            }

            Text {
                id: statusText
                Layout.fillWidth: true
                text: "留空时会自动检测系统 Chrome、缓存 Chrome for Testing，必要时自动下载。"
                color: root.textColor("textSecondary")
                wrapMode: Text.WordWrap
                font {
                    family: "Microsoft YaHei UI"
                    pixelSize: 12
                }
            }
        }

        Item {
            Layout.fillHeight: true
            Layout.minimumHeight: 8
        }
    }
}
